import { flags, SfdxCommand } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { Record } from "jsforce";
import * as _ from "lodash";
import { getDataConfig, getObjectsToProcess, removeField } from "../../helper/helper";
import { Config, Context, ExportResult, PostExportContext, PostExportObjectContext, PreExportContext, PreExportObjectContext } from "../../types";
import * as pathUtils from "path";
import * as fs from "fs";
import * as colors from "colors";
import { runScript } from "../../helper/script";

Messages.importMessagesDirectory(__dirname);

const messages = Messages.loadMessages("json-bourne-sfdx", "org");

export default class Export extends SfdxCommand {
  public static description = messages.getMessage("pullDescription");

  public static examples = [
    `$ sfdx bourne:export -o Product2 -u myOrg -c config/cpq-cli-def.json
    Requesting data, please wait.... Request completed! Received X records.
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
      description: messages.getMessage("pullAllDescription"),
    }),
  };

  protected static requiresUsername = true;

  private _dataConfig: Config;
  protected get dataConfig(): Config {
    if (!this._dataConfig) {
      this._dataConfig = getDataConfig(this.flags);
    }
    return this._dataConfig;
  }

  private get objectsToProcess(): string[] {
    return _.uniq(getObjectsToProcess(this.flags, this.dataConfig));
  }

  private context: Context;

  private exportRecordsToDir(records: Record[], sObjectType: string, dirPath: string) {
    const externalIdField = this.dataConfig.objects?.[sObjectType]?.externalid;
    if (records.length > 0 && !records[0](externalIdField)) {
      throw new SfdxError(
        "The External Id provided on the configuration file does not exist on the extracted record(s). Please ensure it is included in the object's query."
      );
    }

    records.forEach((record) => {
      removeField(record, "attributes");
      this.removeNullFields(record, sObjectType);
      let fileName = record[externalIdField];
      if (fileName == null) {
        throw new SfdxError(
          "There are records without External Ids. Ensure all records that are extracted have a value for the field specified as the External Id."
        );
      } else {
        fileName = pathUtils.join(dirPath, `${fileName.replace(/\s+/g, "-")}.json`);
        fs.writeFile(fileName, JSON.stringify(record, undefined, 2), function (err) {
          if (err) {
            throw err;
          }
        });
      }
    });
  }

  private removeNullFields(record: Record, sObjectType: string) {
    const cleanupFields = this.dataConfig.objects[sObjectType].cleanupFields;
    if (cleanupFields) {
      cleanupFields.forEach((field) => {
        if (null === record[field]) {
          delete record[field];
          let lookupField: string;
          if (field.substr(field.length - 3) == "__r") {
            lookupField = field.substr(0, field.length - 1) + "c";
          } else {
            lookupField = field + "Id";
          }
          record[lookupField] = null;
        }
      });
    }
  }

  private async getExportRecords(sObjectType: string): Promise<Record[]> {
    const queryResult = await this.org
      .getConnection()
      .query<Record>(this.dataConfig.objects[sObjectType].query, { autoFetch: true, maxFetch: 100000 });
    this.ux.log("total in database : " + queryResult.totalSize);
    this.ux.log("total fetched : " + (queryResult.records ? queryResult.records.length : 0));
    return queryResult.records || [];
  }

  private clearDirectory(dirPath: string) {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach((file) => {
        fs.unlink(dirPath + "/" + file, (err) => {
          if (err) {
            throw err;
          }
        });
      });
    } else {
      fs.mkdirSync(dirPath);
    }
  }

  private async preExportObject(sObjectType: string) {
    const scriptPath = this.dataConfig?.script?.preimportobject;
    if (scriptPath) {
      const context: PreExportObjectContext = {
        ...this.context,
        sObjectType,
        objectConfig: this.dataConfig.objects?.[sObjectType],
      };

      await runScript<PreExportObjectContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async postExportObject(sObjectType: string, records: Record[]) {
    const scriptPath = this.dataConfig?.script?.postimportobject;
    if (scriptPath) {
      const context: PostExportObjectContext = {
        ...this.context,
        sObjectType,
        objectConfig: this.dataConfig.objects?.[sObjectType],
        records,
      };

      await runScript<PostExportObjectContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async exportObject(sObjectType: string): Promise<ExportResult> {
    await this.preExportObject(sObjectType)

    this.ux.startSpinner(`Retrieving ${colors.blue(sObjectType)} records, please wait...`);

    const records: Record[] = await this.getExportRecords(sObjectType);
    const dirPath = pathUtils.join("data", this.dataConfig.objects?.[sObjectType]?.directory || sObjectType);
    this.clearDirectory(dirPath);
    this.exportRecordsToDir(records, sObjectType, dirPath);

    await this.postExportObject(sObjectType, records);

    this.ux.stopSpinner(`Request completed! Received ${records.length} records.`);

    return {
      sObjectType,
      records
    };
  }

  private async preExport(): Promise<void> {
    const scriptPath = this.dataConfig?.script?.preexport;
    if (scriptPath) {
      await runScript<PreExportContext>(scriptPath, this.context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async postExport(results: ExportResult[]): Promise<void> {
    const scriptPath = this.dataConfig?.script?.postexport;
    if (scriptPath) {
      const context: PostExportContext = { ...this.context, results };
      await runScript<PostExportContext>(scriptPath, context, {
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

    await this.preExport();

    const sObjectTypes = this.objectsToProcess;

    const results: ExportResult[] = [];
    for (const sObjectType of sObjectTypes) {
      results.push(await this.exportObject(sObjectType));
    }

    await this.postExport(results);

    return results as any;
  }
}
