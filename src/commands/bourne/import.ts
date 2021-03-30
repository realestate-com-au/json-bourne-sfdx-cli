/* eslint-disable no-prototype-builtins */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { core, flags, SfdxCommand } from "@salesforce/command";
import { getDataConfig, getObjectsToProcess, messages } from "../../helper/helper";
import { AnyJson } from "@salesforce/ts-types";
import * as _ from "lodash";
import {
  DataConfiguration,
  DataImportContext,
  DataImportRequest,
  DataImportResult,
  DataImportResultContext,
  ObjectDataImportContext,
  ObjectDataImportResultContext,
  RecordImportResult,
} from "../../types";
import * as fs from "fs";
import * as pathUtils from "path";
import * as colors from "colors";
import { runScript } from "../../helper/script";

export default class Import extends SfdxCommand {
  public static description = messages.getMessage("pushDescription");

  public static examples = [
    `$ sfdx bourne:import -o Product2 -u myOrg -c config/cpq-cli-def.json
    Deploying data, please wait.... Deployment completed!
    `,
  ];

  protected static flagsConfig: any = {
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

  private _dataConfig: DataConfiguration;
  protected get dataConfig(): DataConfiguration {
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
    return this.flags.datadir ? this.flags.datadir : "data";
  }

  private get connection(): core.Connection {
    return this.org.getConnection();
  }

  private importContext: DataImportContext;

  private async getRecordTypesByDeveloperName(sObject: string): Promise<{ [developerName: string]: any }> {
    const r = {};
    this.ux.startSpinner("Retrieving Record Type Information");
    const queryResult = await this.connection.query<any>(
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

  private readRecord(recordPath: string, recordTypes: { [developerName: string]: any }): any {
    let record;
    try {
      record = JSON.parse(fs.readFileSync(recordPath, { encoding: "utf8" }));
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
        throw new core.SfdxError("Record Type not found for " + record.RecordType.DeveloperName);
      }
    }
  }

  private async readRecords(sObjectType: string): Promise<any[]> {
    const objectConfig = this.dataConfig[sObjectType];
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

  private buildRequests(records: any[], sObjectType: string, payloads: DataImportRequest[]) {
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

  private static splitInHalf(records: any[]): any[][] {
    const halfSize = Math.floor(records.length / 2);
    const splitRecords = [];
    splitRecords.push(records.slice(0, halfSize));
    splitRecords.push(records.slice(halfSize));
    return splitRecords;
  }

  private _requestHandler = async (request: DataImportRequest): Promise<RecordImportResult[]> => {
    const restUrl = this.dataConfig.useManagedPackage ? "/JSON/bourne/v1" : "/bourne/v1";
    try {
      const resultJSON = await this.connection.apex.post<string>(restUrl, request);
      return JSON.parse(resultJSON);
    } catch (error) {
      this.ux.log(error);
      throw error;
    }
  };

  private async importRecords(records: any[], sObjectType: string): Promise<DataImportResult> {
    const results: RecordImportResult[] = [];
    if (records.length > 0) {
      const resultsHandler = (items: RecordImportResult[]) => {
        if (items) {
          items.forEach((item) => results.push(item));
        }
      };
      const requests: DataImportRequest[] = [];
      this.buildRequests(records, sObjectType, requests);
      if (this.dataConfig[sObjectType]?.enableMultiThreading) {
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
      failureResults,
      failure: failureResults.length,
      success: results.length - failureResults.length,
    };
  }

  private async preImportObject(sObjectType: string, records: any[]) {
    const preImportObjectScripts = this.dataConfig?.scripts?.postimport;
    if (preImportObjectScripts && preImportObjectScripts.length > 0) {
      const context: ObjectDataImportContext = {
        ...this.importContext,
        sObjectType,
        objectConfig: this.dataConfig[sObjectType],
        records,
      };
      for (const postImportScript of preImportObjectScripts) {
        await runScript<ObjectDataImportContext>(postImportScript, context, {
          tsResolveBaseDir: this.dataConfig.tsResolveBaseDir,
        });
      }
    }
  }

  private async postImportObject(sObjectType: string, records: any[], result: DataImportResult) {
    const postImportObjectScripts = this.dataConfig?.scripts?.postimport;
    if (postImportObjectScripts && postImportObjectScripts.length > 0) {
      const context: ObjectDataImportResultContext = {
        ...this.importContext,
        sObjectType,
        objectConfig: this.dataConfig[sObjectType],
        records,
        result
      };
      for (const postImportScript of postImportObjectScripts) {
        await runScript<ObjectDataImportResultContext>(postImportScript, context, {
          tsResolveBaseDir: this.dataConfig.tsResolveBaseDir,
        });
      }
    }
  }

  private async importRecordsForObject(sObjectType: string): Promise<DataImportResult> {
    const records = await this.readRecords(sObjectType);

    if (!records || records.length === 0) {
      return;
    }

    await this.preImportObject(sObjectType, records);

    let retries = 0;
    let importResult: DataImportResult;

    while (retries < this.dataConfig.importRetries) {
      if (retries > 0) {
        this.ux.log(`Retrying ${colors.blue(sObjectType)} import...`);
      } else {
        this.ux.log(`Importing ${colors.blue(sObjectType)} records`);
      }

      const importResult = await this.importRecords(records, sObjectType);

      if (importResult.failure === 0) {
        break;
      }

      retries++;
    }

    if (importResult.failure > 0) {
      throw `Import was unsuccessful after ${this.dataConfig.importRetries} attempts`;
    }

    await this.postImportObject(sObjectType, records, importResult);

    return importResult;
  }

  private async preImport(): Promise<void> {
    const preImportScripts = this.dataConfig?.scripts?.preimport;
    if (preImportScripts && preImportScripts.length > 0) {
      for (const preImportScript of preImportScripts) {
        await runScript<DataImportContext>(preImportScript, this.importContext, {
          tsResolveBaseDir: this.dataConfig.tsResolveBaseDir,
        });
      }
    }
  }

  private async postImport(allResults: DataImportResult[]): Promise<void> {
    const postImportScripts = this.dataConfig?.scripts?.postimport;
    if (postImportScripts && postImportScripts.length > 0) {
      const context = { ...this.importContext, allResults };
      for (const postImportScript of postImportScripts) {
        await runScript<DataImportResultContext>(postImportScript, context, {
          tsResolveBaseDir: this.dataConfig.tsResolveBaseDir,
        });
      }
    }
  }

  public async run(): Promise<AnyJson> {
    this.importContext = {
      config: this.dataConfig,
      state: {},
    };

    await this.preImport();

    const sObjects = this.objectsToProcess;
    const allResults: DataImportResult[] = [];

    for (const sObject of sObjects) {
      allResults.push(await this.importRecordsForObject(sObject));
    }

    await this.postImport(allResults);

    delete this.importContext;

    return allResults as any;
  }
}
