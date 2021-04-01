import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { getDataConfig, getObjectsToProcess } from "../../helper/helper";
import { AnyJson } from "@salesforce/ts-types";
import * as _ from "lodash";
import {
  Config,
  Context,
  RecordContext,
  ImportRequest,
  ImportResult,
  PostImportObjectContext,
  RecordImportResult,
  PostImportContext,
  PreImportContext,
  PreImportObjectContext,
} from "../../types";
import * as fs from "fs";
import * as pathUtils from "path";
import * as colors from "colors";
import { runScript } from "../../helper/script";
import { Record } from "jsforce";

Messages.importMessagesDirectory(__dirname);

const messages = Messages.loadMessages("json-bourne-sfdx", "org");

export default class Import extends SfdxCommand {
  public static description = messages.getMessage("pushDescription");

  public static examples = [
    `$ sfdx bourne:import -o Product2 -u myOrg -c config/cpq-cli-def.json
    Deploying data, please wait.... Deployment completed!
    `,
  ];

  protected static flagsConfig = {
    object: flags.string({
      char: "o",
      description: messages.getMessage("objectDescription"),
    }),
    configfile: flags.string({
      char: "c",
      description: messages.getMessage("configFileDescription"),
    }),
    processall: flags.boolean({
      char: "a",
      description: messages.getMessage("pushAllDescription"),
    }),
    datadir: flags.string({
      char: "d",
      description: messages.getMessage("pathToDataDir"),
    }),
    remove: flags.boolean({
      char: "r",
      description: messages.getMessage("removeObjects"),
    }),
  };

  public static args = [{ name: "file" }];

  protected static requiresUsername = true;

  private _dataConfig: Config;
  protected get dataConfig(): Config {
    if (!this._dataConfig) {
      this._dataConfig = getDataConfig(this.flags);
    }
    return this._dataConfig;
  }

  private get objectsToProcess() {
    const sObjects = getObjectsToProcess(this.flags, this.dataConfig);
    return this.flags.remove ? _.uniq(sObjects.reverse()) : sObjects;
  }

  private get dataDir(): string {
    return this.flags.datadir || "data";
  }

  private context: Context;

  private async getRecordTypesByDeveloperName(sObject: string): Promise<{ [developerName: string]: Record }> {
    const r = {};
    this.ux.startSpinner("Retrieving Record Type Information");
    const queryResult = await this.org.getConnection().query<Record>(
      `SELECT Id, Name, DeveloperName FROM RecordType WHERE sObjectType = '${sObject}'`
    );
    if (queryResult?.records && queryResult.records.length > 0) {
      queryResult.records.forEach((recordType) => {
        r[recordType.DeveloperName] = recordType;
      });
    }

    this.ux.stopSpinner("RecordType information retrieved");
    return r;
  }

  private readRecord(recordPath: string, recordTypes: { [developerName: string]: Record }): Record {
    let record: Record;
    try {
      record = JSON.parse(fs.readFileSync(recordPath, { encoding: 'utf8' }));
    } catch (e) {
      this.ux.error(`Cound not load record from file: ${recordPath}`);
      return;
    }

    if (recordTypes) {
      const recordTypeId = recordTypes?.[record.RecordType?.DeveloperName]?.Id;
      if (recordTypeId) {
        record.RecordTypeId = recordTypeId;
        delete record.RecordType;
      } else if (record.RecordType) {
        this.ux.log("This record does not contain a value for Record Type, skipping transformation.");
      } else {
        throw new SfdxError("Record Type not found for " + record.RecordType.DeveloperName);
      }
    }

    return record;
  }

  private async readRecords(sObjectType: string): Promise<Record[]> {
    const objectConfig = this.dataConfig.objects?.[sObjectType];
    if (objectConfig) {
      const objectDirPath = pathUtils.join(this.dataDir, objectConfig.directory);
      if (fs.existsSync(objectDirPath)) {
        const files = fs.readdirSync(objectDirPath);
        if (files.length > 0) {
          let recordTypes;
          if (objectConfig.hasRecordTypes) {
            recordTypes = await this.getRecordTypesByDeveloperName(sObjectType);
          }
          return files.map((file) => {
            return this.readRecord(pathUtils.join(objectDirPath, file), recordTypes);
          });
        }
      }
    }
    return [];
  }

  private buildRequests(records: Record[], sObjectType: string, payloads: ImportRequest[]) {
    const payload = JSON.stringify(records, null, 0);
    if (payload.length > this.dataConfig.payloadLength) {
      const splitRecords = Import.splitInHalf(records);
      this.buildRequests(splitRecords[0], sObjectType, payloads);
      this.buildRequests(splitRecords[1], sObjectType, payloads);
    } else {
      payloads.push({
        extIdField: this.dataConfig?.objects?.[sObjectType].externalid,
        operation: this.flags.remove ? "delete" : "upsert",
        payload: records,
        sObjectType: sObjectType,
      });
    }
  }

  private static splitInHalf(records: Record[]): Record[][] {
    const halfSize = Math.floor(records.length / 2);
    const splitRecords = [];
    splitRecords.push(records.slice(0, halfSize));
    splitRecords.push(records.slice(halfSize));
    return splitRecords;
  }

  private _requestHandler = async (request: ImportRequest): Promise<RecordImportResult[]> => {
    const restUrl = this.dataConfig.useManagedPackage ? "/JSON/bourne/v1" : "/bourne/v1";
    try {
      return JSON.parse(await this.org.getConnection().apex.post<string>(restUrl, request));
    } catch (error) {
      this.ux.log(error);
      throw error;
    }
  };

  private async importRecords(records: Record[], sObjectType: string): Promise<ImportResult> {
    const results: RecordImportResult[] = [];
    if (records.length > 0) {
      const resultsHandler = (items: RecordImportResult[]) => {
        if (items) {
          items.forEach((item) => results.push(item));
        }
      };
      const requests: ImportRequest[] = [];
      this.buildRequests(records, sObjectType, requests);
      if (this.dataConfig.objects?.[sObjectType]?.enableMultiThreading) {
        const promises = requests.map(this._requestHandler);
        const promiseResults: RecordImportResult[][] = await Promise.all(promises);
        promiseResults.forEach(resultsHandler);
      } else {
        for (const request of requests) {
          resultsHandler(await this._requestHandler(request));
        }
      }
    }
    const failureResults = results.filter((result) => result.result === "FAILED");
    return {
      sObjectType,
      records,
      results,
      total: results.length,
      failureResults: failureResults.length > 0 ? failureResults : undefined,
      failure: failureResults.length,
      success: results.length - failureResults.length,
    };
  }

  private async preImportObject(sObjectType: string, records: Record[]) {
    const scriptPath = this.dataConfig?.script?.preimportobject;
    if (scriptPath) {
      const context: PreImportObjectContext = {
        ...this.context,
        sObjectType,
        objectConfig: this.dataConfig.objects?.[sObjectType],
        records,
      };

      await runScript<RecordContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async postImportObject(sObjectType: string, records: Record[], importResult: ImportResult) {
    const scriptPath = this.dataConfig?.script?.postimportobject;
    if (scriptPath) {
      const context: PostImportObjectContext = {
        ...this.context,
        sObjectType,
        objectConfig: this.dataConfig.objects?.[sObjectType],
        records,
        importResult,
      };

      await runScript<PostImportObjectContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async importRecordsForObject(sObjectType: string): Promise<ImportResult> {
    const records = await this.readRecords(sObjectType);

    if (!records || records.length === 0) {
      return;
    }

    this.ux.startSpinner(`Importing ${colors.blue(sObjectType)} records`);

    await this.preImportObject(sObjectType, records);

    let retries = 0;
    let importResult: ImportResult;

    while (retries < this.dataConfig.importRetries) {
      if (retries > 0) {
        this.ux.log(`Retrying ${colors.blue(sObjectType)} import...`);
      }

      importResult = await this.importRecords(records, sObjectType);

      if (importResult.failure === 0) {
        break;
      }

      retries++;
    }

    if (importResult.failure > 0) {
      throw `Import was unsuccessful after ${this.dataConfig.importRetries} attempts`;
    }

    await this.postImportObject(sObjectType, records, importResult);

    this.ux.stopSpinner();

    return importResult;
  }

  private async preImport(): Promise<void> {
    const scriptPath = this.dataConfig?.script?.preimport;
    if (scriptPath) {
      await runScript<PreImportContext>(scriptPath, this.context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async postImport(results: ImportResult[]): Promise<void> {
    const scriptPath = this.dataConfig?.script?.postimport;
    if (scriptPath) {
      const context: PostImportContext = { ...this.context, results };
      await runScript<PostImportContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  public async run(): Promise<AnyJson> {
    this.context = {
      command: {
        args: this.args,
        configAggregator: this.configAggregator,
        flags: this.flags,
        logger: this.logger,
        ux: this.ux,
        hubOrg: this.hubOrg,
        org: this.org,
        project: this.project,
        varargs: this.varargs,
        result: this.result,
      },
      config: this.dataConfig,
      state: {},
    };

    await this.preImport();

    const sObjects = this.objectsToProcess;
    const allResults: ImportResult[] = [];

    for (const sObject of sObjects) {
      allResults.push(await this.importRecordsForObject(sObject));
    }

    await this.postImport(allResults);

    delete this.context;

    return allResults as any;
  }
}
