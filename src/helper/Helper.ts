/* eslint-disable @typescript-eslint/no-explicit-any */
import { core } from "@salesforce/command";
import { DataConfiguration } from "../types";
import * as fs from "fs";

export const messages = core.Messages.loadMessages(
  "json-bourne-sfdx",
  "org"
);

// Initialize Messages with the current plugin directory
core.Messages.importMessagesDirectory(__dirname);

export const removeField = (record: any, fieldName: string): void => {
  delete record[fieldName];
  for(const key in record) {
    const value = record[key];
    if(value !== null && typeof value === 'object') {
      removeField(value, fieldName);
    }
  }
};

const getAllObjectsToProcess = (config: DataConfiguration): string[] => {
  return config.allObjects;
}

const getSingleObjectToProcess = (flags: any, config: DataConfiguration): string[] => {
  if (flags.object in config.objects) {
    return [flags.object];
  }
  throw new core.SfdxError(
    "There is no configuration for this object."
  );
}

export const getObjectsToProcess = (flags: any, config: DataConfiguration): string[] => {
  if (flags.processall && flags.object) {
    throw new core.SfdxError(
      "You cannot specify both process all flag and an object name"
    );
  }
  return flags.processall
    ? getAllObjectsToProcess(config)
    : getSingleObjectToProcess(flags, config);
}

export const getDataConfig = (flags: any): DataConfiguration => {
  if(fs.existsSync(flags.configFile)) {
    const configPath = `${process.cwd()}/${flags.configFile}`;
    console.log("Load config from " + configPath);
    return JSON.parse(fs.readFileSync(configPath, { encoding: "utf8" }));
  }
  
  throw new core.SfdxError(
    `Unable to find configuration file: ${flags.configFile}`
  );
}
