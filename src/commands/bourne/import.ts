import { flags, SfdxCommand, SfdxResult, TableOptions } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { getDataConfig, getObjectsToProcess } from "../../helper/helper";
import { AnyJson } from "@salesforce/ts-types";
import {
  Config,
  ObjectContext,
  ImportRequest,
  ImportResult,
  PostImportObjectContext,
  RecordImportResult,
  PostImportContext,
  PreImportContext,
  PreImportObjectContext,
  ImportService,
  ImportContext,
  ObjectConfig,
} from "../../types";
import * as fs from "fs";
import * as pathUtils from "path";
import * as colors from "colors";
import { runScript } from "../../helper/script";
import { Record } from "jsforce";

Messages.importMessagesDirectory(__dirname);

const messages = Messages.loadMessages("json-bourne-sfdx", "org");

const objectImportResultTableOptions: TableOptions = {
  columns: [
    { key: "recordId", label: "ID" },
    { key: "externalId", label: "External ID" },
    { key: "result", label: "Status" },
    { key: "message", label: "Message" },
  ],
};

export default class Import extends SfdxCommand implements ImportService {
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
    allowpartial: flags.boolean({
      char: "p",
      description: messages.getMessage("allowPartial")
    })
  };

  protected static requiresUsername = true;

  public static result: SfdxResult = {
    tableColumnData: {
      columns: [
        {
          key: "sObjectType",
          label: "SObject Type",
        },
        {
          key: "total",
          label: "Total",
        },
        {
          key: "success",
          label: "Success",
        },
        {
          key: "failure",
          label: "Failure",
        },
      ],
    },
  };

  private _dataConfig: Config;
  protected get dataConfig(): Config {
    if (!this._dataConfig) {
      this._dataConfig = getDataConfig(this.flags);
    }
    return this._dataConfig;
  }

  private get objectsToProcess(): ObjectConfig[] {
    const sObjects = getObjectsToProcess(this.flags, this.dataConfig);
    return this.flags.remove ? sObjects.reverse() : sObjects;
  }

  private get dataDir(): string {
    return this.flags.datadir || "data";
  }

  private context: ImportContext;

  private async getRecordTypesByDeveloperName(sObject: string): Promise<{ [developerName: string]: Record }> {
    const r = {};
    this.ux.startSpinner("Retrieving Record Type Information");
    const queryResult = await this.org
      .getConnection()
      .query<Record>(`SELECT Id, Name, DeveloperName FROM RecordType WHERE sObjectType = '${sObject}'`);
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
      record = JSON.parse(fs.readFileSync(recordPath, { encoding: "utf8" }));
    } catch (e) {
      this.ux.error(`Cound not load record from file: ${recordPath}`);
    }

    if (record && recordTypes) {
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

  public async readRecords(objectConfig: ObjectConfig): Promise<Record[]> {
    const records: Record[] = [];
    if (objectConfig) {
      const objectDirPath = pathUtils.join(this.dataDir, objectConfig.directory);
      if (fs.existsSync(objectDirPath)) {
        const files = fs.readdirSync(objectDirPath);
        if (files.length > 0) {
          let recordTypes;
          if (objectConfig.hasRecordTypes) {
            recordTypes = await this.getRecordTypesByDeveloperName(objectConfig.sObjectType);
          }
          files.forEach((file) => {
            const record = this.readRecord(pathUtils.join(objectDirPath, file), recordTypes);
            if (record) {
              records.push(record);
            }
          });
        }
      }
    }
    return records;
  }

  private buildRequests(records: Record[], objectConfig: ObjectConfig, payloads: ImportRequest[]) {
    const payload = JSON.stringify(records, null, 0);
    if (payload.length > this.dataConfig.payloadLength) {
      const splitRecords = Import.splitInHalf(records);
      this.buildRequests(splitRecords[0], objectConfig, payloads);
      this.buildRequests(splitRecords[1], objectConfig, payloads);
    } else {
      payloads.push({
        extIdField: objectConfig.externalid,
        operation: this.flags.remove ? "delete" : "upsert",
        payload: records,
        sObjectType: objectConfig.sObjectType,
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

  public async importRecords(objectConfig: ObjectConfig, records: Record[]): Promise<ImportResult> {
    const results: RecordImportResult[] = [];
    if (records.length > 0) {
      const resultsHandler = (items: RecordImportResult[]) => {
        if (items) {
          items.forEach((item) => results.push(item));
        }
      };
      const requests: ImportRequest[] = [];
      this.buildRequests(records, objectConfig, requests);
      if (objectConfig.enableMultiThreading) {
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
      sObjectType: objectConfig.sObjectType,
      records,
      results,
      total: results.length,
      failureResults: failureResults.length > 0 ? failureResults : undefined,
      failure: failureResults.length,
      success: results.length - failureResults.length,
    };
  }

  private async preImportObject(objectConfig: ObjectConfig, records: Record[]) {
    const scriptPath = this.dataConfig?.script?.preimportobject;
    if (scriptPath) {
      const context: PreImportObjectContext = {
        ...this.context,
        objectConfig,
        records,
      };

      await runScript<ObjectContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async postImportObject(objectConfig: ObjectConfig, records: Record[], importResult: ImportResult) {
    const scriptPath = this.dataConfig?.script?.postimportobject;
    if (scriptPath) {
      const context: PostImportObjectContext = {
        ...this.context,
        objectConfig,
        records,
        importResult,
      };

      await runScript<PostImportObjectContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async importRecordsForObject(objectConfig: ObjectConfig): Promise<ImportResult> {
    const records = await this.readRecords(objectConfig);
    if (!records || records.length === 0) {
      return {
        sObjectType: objectConfig.sObjectType,
        failure: 0,
        success: 0,
        records: [],
        results: [],
        total: 0,
      };
    }

    this.ux.startSpinner(`Importing ${colors.blue(objectConfig.sObjectType)} records`);

    await this.preImportObject(objectConfig, records);

    let retries = 0;
    let importResult: ImportResult;

    while (retries < this.dataConfig.importRetries) {
      if (retries > 0) {
        this.ux.log(`Retrying ${colors.blue(objectConfig.sObjectType)} import...`);
      }

      importResult = await this.importRecords(objectConfig, records);

      if (importResult.failure === 0) {
        break;
      }

      retries++;
    }

    if (
      importResult.failure > 0 &&
      !this.dataConfig.allowPartial &&
      !this.flags.allowpartial
    ) {
      throw new SfdxError(`Import was unsuccessful after ${this.dataConfig.importRetries} attempts`);
    }

    await this.postImportObject(objectConfig, records, importResult);

    this.ux.stopSpinner(`${importResult.total} records processed`);

    this.ux.table(importResult.results, objectImportResultTableOptions);

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
    const objectConfigs = this.objectsToProcess;
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
      objectConfigs,
      service: this,
      state: {},
    };

    await this.preImport();

    
    const results: ImportResult[] = [];

    for (const objectConfig of objectConfigs) {
      results.push(await this.importRecordsForObject(objectConfig));
    }

    await this.postImport(results);

    delete this.context;

    return results as any;
  }
}
