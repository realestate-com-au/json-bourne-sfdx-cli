/* eslint-disable no-prototype-builtins */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { core, flags, SfdxCommand } from "@salesforce/command";
import { Connection } from "jsforce";
import { Helper } from "../../helper/Helper";
import { ImportResult } from "../../helper/ImportResult";
import { CPQDataImportRequest } from "../../model/CPQDataImportRequest";
import { AnyJson } from "@salesforce/ts-types";
import * as _ from "lodash";
import { runScript } from "../../helper/script";

export default class Import extends SfdxCommand {
  public static description = Helper.messages.getMessage("pushDescription");

  public static examples = [
    `$ sfdx bourne:import -o Product2 -u myOrg -c config/cpq-cli-def.json
    Deploying data, please wait.... Deployment completed!
    `,
  ];

  protected static flagsConfig: any = {
    object: flags.string({
      char: "o",
      description: Helper.messages.getMessage("objectDescription"),
    }),
    configfile: flags.string({
      char: "c",
      description: Helper.messages.getMessage("configFileDescription"),
    }),
    processall: flags.boolean({
      char: "a",
      description: Helper.messages.getMessage("pushAllDescription"),
    }),
    datadir: flags.string({
      char: "d",
      description: Helper.messages.getMessage("pathToDataDir"),
    }),
    remove: flags.boolean({
      char: "r",
      description: Helper.messages.getMessage("removeObjects"),
    }),
  };

  public static args = [{ name: "file" }];

  protected static requiresUsername = true;

  protected static config;

  protected connection;

  private objectsToProcess() {
    const sObjects = Helper.getObjectsToProcess(this.flags, Import.config);
    return this.flags.remove === true ? _.uniq(sObjects.reverse()) : sObjects;
  }

  private getDataDir() {
    return this.flags.datadir ? this.flags.datadir : "data";
  }

  private async getRecordTypeRef(sObject, configObject) {
    const recordTypeRef = {};
    if (configObject.hasRecordTypes) {
      this.ux.log(Helper.colors.blue("Aligning RecordType IDs..."));
      this.ux.startSpinner("Processing");
      const recordTypes: any = await this.connection.query(
        `SELECT Id, Name, DeveloperName FROM RecordType WHERE sObjectType ='${sObject}'`
      );
      if (recordTypes && recordTypes.records.length > 0) {
        recordTypes.records.forEach((recordType) => {
          recordTypeRef[recordType.DeveloperName] = recordType.Id;
        });
      }
      this.ux.stopSpinner("RecordType information retrieved");
    }
    return recordTypeRef;
  }

  private readRecords(configObject: any) {
    const dirPath = this.getDataDir() + "/" + configObject.directory;
    if (Helper.fs.existsSync(dirPath)) {
      const files = Helper.fs.readdirSync(dirPath);
      return files.map((file) => {
        const filePath = dirPath + "/" + file;
        try {
          return Helper.fs.readFileSync(filePath, "utf8");
        } catch (e) {
          console.error(Helper.colors.red("Could not load " + filePath));
        }
        return;
      });
    }
    return [];
  }

  private resolveToSObjects(recordTypeRef: any, configObject: any, originalRecords: any[]) {
    return originalRecords.map((original) => {
      const record = JSON.parse(original);
      if (configObject.hasRecordTypes && recordTypeRef) {
        if (recordTypeRef.hasOwnProperty(record.RecordType.DeveloperName)) {
          record.RecordTypeId = recordTypeRef[record.RecordType.DeveloperName];
          delete record.RecordType;
        } else if (record.RecordType) {
          this.ux.log("This record does not contain a value for Record Type, skipping transformation.");
        } else {
          throw new core.SfdxError("Record Type not found for " + record.RecordType.DeveloperName);
        }
      }
      return record;
    });
  }

  private createPayload(records, configObject, sObject, payloads: Array<CPQDataImportRequest>) {
    const payload = JSON.stringify(records, null, 0);
    if (payload.length > Import.config.payloadLength) {
      const splitRecords = Import.splitInHalf(records);
      this.createPayload(splitRecords[0], configObject, sObject, payloads);
      this.createPayload(splitRecords[1], configObject, sObject, payloads);
    } else {
      const operation = this.flags.remove === true ? "delete" : "upsert";
      const dataImportObj: CPQDataImportRequest = new CPQDataImportRequest(
        sObject,
        operation,
        records,
        configObject.externalid
      );
      payloads.push(dataImportObj);
    }
  }

  private static splitInHalf(records) {
    const halfSize = records.length / 2;
    const splitRecords = [];
    splitRecords.push(records.slice(0, halfSize));
    splitRecords.push(records.slice(halfSize));
    return splitRecords;
  }

  private getProcessPayload(isManagedPackage) {
    const restUrl = isManagedPackage == true ? "/JSON/bourne/v1" : "/bourne/v1";
    return async (payload, connection) => {
      try {
        return connection.apex.post(restUrl, payload);
      } catch (error) {
        this.ux.log(error);
        throw error;
      }
    };
  }

  private async importRecords(
    records: any[],
    configObject: any,
    sObject: any,
    connection: Connection,
    useManagedPackage: boolean
  ) {
    let responses = [];
    if (records.length > 0) {
      const payloads = [];
      this.createPayload(records, configObject, sObject, payloads);
      const processPayload = this.getProcessPayload(useManagedPackage);
      if (configObject.enableMultiThreading) {
        const promises = [];
        payloads.forEach((payload) => promises.push(processPayload(payload, connection)));
        responses = await Promise.all(promises);
      } else {
        for (const i in payloads) {
          const promises = [];
          promises.push(processPayload(payloads[i], connection));
          responses.push(await Promise.all(promises));
        }
      }
    }
    return responses;
  }

  public async run(): Promise<AnyJson> {
    this.connection = this.org.getConnection();
    Import.config = Helper.initConfig(this.flags);
    const sObjects = this.objectsToProcess();
    const allImportResults: ImportResult[] = [];

    const tsNodeResolveBaseDir = Import.config.scripts?.tsNodeResolveBaseDir;

    const importContext = {
      config: Import.config,
      sObjects,
    };

    // global pre and post import script paths
    const preImportScriptPath = Import.config?.scripts?.preimport;
    const postImportScriptPath = Import.config?.scripts?.preimport;
    if (preImportScriptPath) {
      await runScript({ path: preImportScriptPath, context: importContext, tsNodeResolveBaseDir });
    }

    for (const i in sObjects) {
      let success = false;
      let retries = 0;
      do {
        const sObject = sObjects[i];
        const configObject = Import.config.objects[sObject];
        const recordTypeRef = await this.getRecordTypeRef(sObject, configObject);
        const originalRecords = this.readRecords(configObject);
        const records = this.resolveToSObjects(recordTypeRef, configObject, originalRecords);

        // object level pre and post import
        const preImportObjectScriptPath = configObject?.scripts?.preimport;
        const postImportObjectScriptPath = configObject?.scripts?.postimport;
        const objectContext = {
          importContext,
          sObject,
          config: configObject,
          recordTypeRef,
          records,
          flags: this.flags,
          commandId: this.id,
        };
        if (preImportObjectScriptPath) {
          await runScript({ path: preImportObjectScriptPath, context: objectContext, tsNodeResolveBaseDir });
        }

        this.ux.log("Deploying " + Helper.colors.blue(sObject) + " records");

        const responses = await this.importRecords(
          records,
          configObject,
          sObject,
          this.connection,
          Import.config.useManagedPackage
        );

        const importResult = new ImportResult(responses);
        if (postImportObjectScriptPath) {
          await runScript({
            path: postImportObjectScriptPath,
            context: { ...objectContext, result: importResult },
            tsNodeResolveBaseDir,
          });
        }

        importResult.print();
        allImportResults.push(importResult);

        if (importResult.failure == 0) {
          success = true;
        } else if (retries + 1 == Import.config.importRetries) {
          throw "Import was unsuccessful after " + Import.config.importRetries + " attempts.";
        } else {
          this.ux.log("Retrying...");
          retries++;
        }
      } while (success == false && retries < Import.config.importRetries);
    }

    if (postImportScriptPath) {
      await runScript({
        path: preImportScriptPath,
        context: { ...importContext, allImportResults },
        tsNodeResolveBaseDir,
      });
    }

    return JSON.stringify(allImportResults);
  }
}
