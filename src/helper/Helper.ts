/* eslint-disable @typescript-eslint/no-explicit-any */
import { Config } from "../types";
import * as fs from "fs";
import { Record } from "jsforce";
import { SfdxError } from "@salesforce/core";
import { OutputFlags } from '@oclif/parser';

export const removeField = (record: Record, fieldName: string): void => {
  delete record[fieldName];
  for (const key in record) {
    const value = record[key];
    if (value !== null && typeof value === "object") {
      removeField(value, fieldName);
    }
  }
};

const getAllObjectsToProcess = (config: Config): string[] => {
  return config.allObjects;
};

const getSingleObjectToProcess = (flags: any, config: Config): string[] => {
  if (flags.object in config.objects) {
    return [flags.object];
  }
  throw new SfdxError("There is no configuration for this object.");
};

export const getObjectsToProcess = (flags: OutputFlags<any>, config: Config): string[] => {
  if (flags.processall && flags.object) {
    throw new SfdxError("You cannot specify both process all flag and an object name");
  }
  return flags.processall ? getAllObjectsToProcess(config) : getSingleObjectToProcess(flags, config);
};

export const getDataConfig = (flags: OutputFlags<any>): Config => {
  if (fs.existsSync(flags.configfile)) {
    const configPath = `${process.cwd()}/${flags.configfile}`;
    return JSON.parse(fs.readFileSync(configPath, { encoding: "utf8" }));
  }

  throw new SfdxError(`Unable to find configuration file: ${flags.configfile}`);
};
