import { core } from "@salesforce/command";

// Initialize Messages with the current plugin directory
core.Messages.importMessagesDirectory(__dirname);

export class Helper {
  public static fs = require("fs");
  public static cTable = require("console.table");
  public static colors = require("colors");
  public static messages = core.Messages.loadMessages(
    "json-bourne-sfdx",
    "org"
  );

  public static removeField(record, fieldName) {
    delete record[fieldName];
    for (let i in record) {
      if (record[i] != null && typeof record[i] === "object") {
        Helper.removeField(record[i], fieldName);
      }
    }
  }

  public static getObjectsToProcess(flags, config) {
    if (flags.processall === true && flags.object) {
      throw new core.SfdxError(
        "You cannot specify both process all flag and an object name"
      );
    }
    return flags.processall === true
      ? this.getAllObjectsToProcess(config)
      : this.getSingleObjectToProcess(flags, config);
  }

  public static initConfig(flags) {
    if (Helper.fs.existsSync(flags.configfile)) {
      let configPath = process.cwd() + "/" + flags.configfile;
      console.log("Load config from " + configPath);
      return require(configPath);
    } else {
      throw new core.SfdxError(
        Helper.messages.getMessage(
          "No configuration file found at this location."
        )
      );
    }
  }

  private static getAllObjectsToProcess(config) {
    return config.allObjects;
  }

  private static getSingleObjectToProcess(flags, config) {
    if (flags.object in config.objects) {
      return [flags.object];
    }
    throw new core.SfdxError(
      this.messages.getMessage("There is no configuration for this object.")
    );
  }
}
