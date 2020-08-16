import { core, flags, SfdxCommand } from "@salesforce/command";
import { Connection } from "jsforce";
import { Helper } from "../../helper/Helper";
import { ImportResult } from "../../helper/ImportResult";
import { CPQDataImportRequest } from "../../model/CPQDataImportRequest";
import { AnyJson } from "@salesforce/ts-types";
import * as _ from "lodash";

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
    let sObjects = Helper.getObjectsToProcess(this.flags, Import.config);
    return this.flags.remove === true ? _.uniq(sObjects.reverse()) : sObjects;
  }

  private getDataDir() {
    return this.flags.datadir ? this.flags.datadir : "data";
  }

  private async getRecordTypeRef(sObject, configObject) {
    let recordTypeRef = {};
    if (configObject.hasRecordTypes) {
      console.log(Helper.colors.blue("Aligning RecordType IDs..."));
      this.ux.startSpinner("Processing");
      let recordTypes: any = await this.connection.query(
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
    let dirPath = this.getDataDir() + "/" + configObject.directory;
    if (Helper.fs.existsSync(dirPath)) {
      let files = Helper.fs.readdirSync(dirPath);
      return files.map((file) => {
        let filePath = dirPath + "/" + file;
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

  private resolveToSObjects(
    recordTypeRef: any,
    configObject: any,
    originalRecords: any[]
  ) {
    return originalRecords.map((original) => {
      let record = JSON.parse(original);
      if (configObject.hasRecordTypes && recordTypeRef) {
        if (recordTypeRef.hasOwnProperty(record.RecordType.DeveloperName)) {
          record.RecordTypeId = recordTypeRef[record.RecordType.DeveloperName];
          delete record.RecordType;
        } else if (record.RecordType) {
          console.log(
            "This record does not contain a value for Record Type, skipping transformation."
          );
        } else {
          throw new core.SfdxError(
            "Record Type not found for " + record.RecordType.DeveloperName
          );
        }
      }
      return record;
    });
  }

  private createPayload(
    records,
    configObject,
    sObject,
    payloads: Array<CPQDataImportRequest>
  ) {
    let payload = JSON.stringify(records, null, 0);
    if (payload.length > Import.config.payloadLength) {
      let splitRecords = Import.splitInHalf(records);
      this.createPayload(splitRecords[0], configObject, sObject, payloads);
      this.createPayload(splitRecords[1], configObject, sObject, payloads);
    } else {
      let operation = this.flags.remove === true ? "delete" : "upsert";
      let dataImportObj: CPQDataImportRequest = new CPQDataImportRequest(
        sObject,
        operation,
        records,
        configObject.externalid
      );
      payloads.push(dataImportObj);
    }
  }

  private static splitInHalf(records) {
    let halfSize = records.length / 2;
    let splitRecords = [];
    splitRecords.push(records.slice(0, halfSize));
    splitRecords.push(records.slice(halfSize));
    return splitRecords;
  }

  private getProcessPayload(isManagedPackage) {
    let restUrl = isManagedPackage == true ? "/JSON/bourne/v1" : "/bourne/v1";
    return (function () {
      return function (payload, connection) {
        return new Promise((resolve) => {
          let resultPromise = connection.apex.post(restUrl, payload, (err) => {
            if (err) {
              return console.error(err);
            }
          });

          if (typeof resultPromise === "undefined") {
            console.log("Error: Undefined promise");
            return;
          }

          resolve(
            resultPromise
              .then((result) => {
                return result;
              })
              .catch((error) => {
                console.log(error);
              })
          );
        });
      };
    })();
  }

  private async importRecords(
    records: any[],
    configObject: any,
    sObject: any,
    connection: Connection,
    useManagedPackage: Boolean
  ) {
    let responses = [];
    if (records.length > 0) {
      let payloads = [];
      this.createPayload(records, configObject, sObject, payloads);
      let processPayload = this.getProcessPayload(useManagedPackage);
      if (configObject.enableMultiThreading) {
        let promises = [];
        payloads.forEach((payload) =>
          promises.push(processPayload(payload, connection))
        );
        responses = await Promise.all(promises);
      } else {
        for (let i in payloads) {
          let promises = [];
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
    let sObjects = this.objectsToProcess();
    let allImportResults: ImportResult[] = [];

    for (let i in sObjects) {
      let success: boolean = false;
      let retries: number = 0;
      do {
        let sObject = sObjects[i];
        let configObject = Import.config.objects[sObject];
        let recordTypeRef = await this.getRecordTypeRef(sObject, configObject);
        let originalRecords = this.readRecords(configObject);
        let records = this.resolveToSObjects(
          recordTypeRef,
          configObject,
          originalRecords
        );

        console.log("Deploying " + Helper.colors.blue(sObject) + " records");

        let responses = await this.importRecords(
          records,
          configObject,
          sObject,
          this.connection,
          Import.config.useManagedPackage
        );
        let importResult = new ImportResult(responses);
        importResult.print();
        allImportResults.push(importResult);

        if (importResult.failure == 0) {
          success = true;
        } else if (retries + 1 == Import.config.importRetries) {
          throw (
            "Import was unsuccessful after " +
            Import.config.importRetries +
            " attempts."
          );
        } else {
          console.log("Retrying...");
          retries++;
        }
      } while (success == false && retries < Import.config.importRetries);
    }
    return JSON.stringify(allImportResults);
  }
}
