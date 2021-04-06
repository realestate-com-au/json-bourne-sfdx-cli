import { flags, SfdxCommand, SfdxResult } from "@salesforce/command";
import { Messages, SfdxError } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import { Record } from "jsforce";
import {
  getDataConfig,
  getObjectsToProcess,
  removeField,
} from "../../helper/common";
import {
  Config,
  Context,
  ExportResult,
  ObjectConfig,
  PostExportContext,
  PostExportObjectContext,
  PreExportContext,
  PreExportObjectContext,
} from "../../types";
import * as pathUtils from "path";
import * as fs from "fs";
import * as colors from "colors";
import { runScript } from "../../helper/script";

const fsp = fs.promises;

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
          key: "path",
          label: "Path",
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
    return getObjectsToProcess(this.flags, this.dataConfig);
  }

  private context: Context;

  private async exportRecordsToDir(
    records: Record[],
    objectConfig: ObjectConfig,
    dirPath: string
  ): Promise<void> {
    if (!records || records.length === 0) {
      return;
    }

    const externalIdField = objectConfig.externalid;
    if (records.length > 0 && !records[0][externalIdField]) {
      throw new SfdxError(
        "The External Id provided on the configuration file does not exist on the extracted record(s). Please ensure it is included in the object's query."
      );
    }

    const promises = records.map(async (record) => {
      removeField(record, "attributes");
      this.removeNullFields(record, objectConfig);
      let fileName = record[externalIdField];
      if (!fileName) {
        throw new SfdxError(
          "There are records without External Ids. Ensure all records that are extracted have a value for the field specified as the External Id."
        );
      }
      fileName = pathUtils.join(
        dirPath,
        `${fileName.replace(/\s+/g, "-")}.json`
      );
      await fsp.writeFile(fileName, JSON.stringify(record, undefined, 2));
    });

    await Promise.all(promises);
  }

  private removeNullFields(record: Record, objectConfig: ObjectConfig) {
    const cleanupFields = objectConfig.cleanupFields;
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

  private async getExportRecords(
    objectConfig: ObjectConfig
  ): Promise<Record[]> {
    return new Promise((resolve, reject) => {
      var records = [];
      this.org
        .getConnection()
        .query(objectConfig.query)
        .on("record", (record) => {
          records.push(record);
        })
        .on("end", () => {
          resolve(records);
        })
        .on("error", (err) => {
          reject(err);
        })
        .run({ autoFetch: true, maxFetch: 100000 });
    });
  }

  private async clearDirectory(dirPath: string): Promise<void> {
    if (fs.existsSync(dirPath)) {
      const items = await fsp.readdir(dirPath);
      const promises = items.map(async (item) => {
        await fsp.unlink(pathUtils.join(dirPath, item));
      });
      await Promise.all(promises);
    } else {
      fs.mkdirSync(dirPath);
    }
  }

  private async preExportObject(objectConfig: ObjectConfig) {
    const scriptPath = this.dataConfig?.script?.preimportobject;
    if (scriptPath) {
      const context: PreExportObjectContext = {
        ...this.context,
        objectConfig,
      };

      await runScript<PreExportObjectContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async postExportObject(
    objectConfig: ObjectConfig,
    records: Record[]
  ) {
    const scriptPath = this.dataConfig?.script?.postimportobject;
    if (scriptPath) {
      const context: PostExportObjectContext = {
        ...this.context,
        objectConfig,
        records,
      };

      await runScript<PostExportObjectContext>(scriptPath, context, {
        tsResolveBaseDir: this.dataConfig.script.tsResolveBaseDir,
      });
    }
  }

  private async exportObject(
    objectConfig: ObjectConfig
  ): Promise<ExportResult> {
    await this.preExportObject(objectConfig);

    this.ux.startSpinner(
      `Retrieving ${colors.blue(objectConfig.sObjectType)} records`
    );

    const records: Record[] = await this.getExportRecords(objectConfig);
    const path = pathUtils.join(
      process.cwd(),
      "data",
      objectConfig.directory || objectConfig.sObjectType
    );

    await this.clearDirectory(path);
    await this.exportRecordsToDir(records, objectConfig, path);

    await this.postExportObject(objectConfig, records);

    const total = records ? records.length : 0;

    this.ux.stopSpinner(`Saved ${total} records to ${path}`);

    return {
      sObjectType: objectConfig.sObjectType,
      total,
      path,
      records,
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
      state: {},
    };

    await this.preExport();

    const results: ExportResult[] = [];
    for (const objectConfig of objectConfigs) {
      results.push(await this.exportObject(objectConfig));
    }

    await this.postExport(results);

    return results as any;
  }
}
