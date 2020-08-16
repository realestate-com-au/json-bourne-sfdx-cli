import { flags, SfdxCommand, core } from "@salesforce/command";
import { Helper } from "../../helper/Helper";
import { AnyJson } from "@salesforce/ts-types";
import * as _ from "lodash";

export default class Export extends SfdxCommand {
  public static description = Helper.messages.getMessage("pullDescription");

  public static examples = [
    `$ sfdx bourne:export -o Product2 -u myOrg -c config/cpq-cli-def.json
    Requesting data, please wait.... Request completed! Received X records.
    `
  ];

  public static args = [{ name: "file" }];

  protected static flagsConfig: any = {
    object: flags.string({
      char: "o",
      description: Helper.messages.getMessage("objectDescription")
    }),
    configfile: flags.string({
      char: "c",
      description: Helper.messages.getMessage("configFileDescription")
    }),
    processall: flags.boolean({
      char: "a",
      description: Helper.messages.getMessage("pullAllDescription")
    })
  };

  protected static requiresUsername = true;

  protected static config;

  protected connection;

  private objectsToProcess(): String[] {
    return _.uniq(Helper.getObjectsToProcess(this.flags, Export.config));
  }

  private exportRecordsToDir(records, sObjectName, dirPath) {
    let externalIdField = Export.config.objects[sObjectName].externalid;
    if (records.length > 0 && !records[0].hasOwnProperty(externalIdField)) {
      throw new core.SfdxError(
        "The External Id provided on the configuration file does not exist on the extracted record(s). Please ensure it is included in the object's query."
      );
    }

    records.forEach(record => {
      Helper.removeField(record, "attributes");
      this.removeNullFields(record, sObjectName);
      let fileName = record[externalIdField];
      if (fileName == null) {
        throw new core.SfdxError(
          "There are records without External Ids. Ensure all records that are extracted have a value for the field specified as the External Id."
        );
      } else {
        fileName = dirPath + "/" + fileName.replace(/\s+/g, "-") + ".json";
        Helper.fs.writeFile(
          fileName,
          JSON.stringify(record, undefined, 2),
          function(err) {
            if (err) {
              throw err;
            }
          }
        );
      }
    });
  }

  private removeNullFields(record, sObjectName) {
    Export.config.objects[sObjectName].cleanupFields.forEach(fields => {
      if (null === record[fields]) {
        delete record[fields];
        let lookupField: string;
        if (fields.substr(fields.length - 3) == "__r") {
          lookupField = fields.substr(0, fields.length - 1) + "c";
        } else {
          lookupField = fields + "Id";
        }
        record[lookupField] = null;
      }
    });
  }

  private async getExportRecords(sObject: any) {
    return new Promise( (resolve) => {
      var records = [];
      var query = this.connection.query(`${Export.config.objects[sObject].query}`)
      .on("record", (record) => {
        records.push(record);
      })
      .on("end", () => {
        console.log("total in database : " + query.totalSize);
        console.log("total fetched : " + query.totalFetched);
        resolve(records);
      })
      .on("error", (err) => {
        console.error(err);
      })
      .run({ autoFetch : true, maxFetch : 100000 });
    });
  }

  private clearDirectory(dirPath: string) {
    if (Helper.fs.existsSync(dirPath)) {
      Helper.fs.readdirSync(dirPath).forEach(file => {
        Helper.fs.unlink(dirPath + "/" + file, err => {
          if (err) {
            throw err;
          }
        });
      });
    } else {
      Helper.fs.mkdirSync(dirPath);
    }
  }

  public async run(): Promise<AnyJson> {
    this.connection = this.org.getConnection();
    Export.config = Helper.initConfig(this.flags);

    let sObjects = this.objectsToProcess();
    for (let i in sObjects) {
      let sObjectName = sObjects[i].toString();

      this.ux.startSpinner(
        "Retrieving " +
          Helper.colors.blue(sObjectName) +
          " records, please wait..."
      );

      let records: any[] = await this.getExportRecords(sObjectName);
      let dirPath = "data/" + Export.config.objects[sObjectName].directory;
      this.clearDirectory(dirPath);
      this.exportRecordsToDir(records, sObjectName, dirPath);

      this.ux.stopSpinner(
        "Request completed! Received " + records.length + " records."
      );
    }
    return {};
  }
}
