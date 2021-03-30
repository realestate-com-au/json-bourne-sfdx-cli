export interface ObjectDataConfiguration {
  query?: string;
  externalid?: string;
  directory?: string;
  filename?: string;
  cleanupFields?: string[];
  hasRecordTypes?: boolean;
  enableMultiThreading?: boolean;
}

export interface ScriptsConfiguration {
    preimport?: string[];
    preimportobject?: string[];
    postimportobject?: string[];
    postimport?: string[];
    tsResolveBaseDir?: string;
}

export interface DataConfiguration {
  scripts?: ScriptsConfiguration;
  tsResolveBaseDir?: string;
  pollTimeout?: number;
  pollBatchSize?: number;
  maxPollCount?: number;
  payloadLength?: number;
  importRetries?: number;
  useManagedPackage?: boolean;
  allObjects?: string[];
  objects?: { [sObject: string]: ObjectDataConfiguration };
}

export interface DataImportRequest {
  sObjectType: string;
  operation: string;
  payload: any[];
  extIdField: string;
}

export interface RecordImportResult {
  recordId?: string;
  externalId?: string;
  message?: string;
  result?: "SUCCESS" | "FAILED";
}

export interface DataImportResult {
  sObjectType: string;
  records?: any[];
  results?: RecordImportResult[];
  total?: number;
  failure?: number;
  success?: number;
  failureResults?: RecordImportResult[];
}

export interface DataImportContext {
  config: DataConfiguration;
  state: {
    [key: string]: any
  }
}

export interface ObjectDataImportContext extends DataImportContext {
  sObjectType: string;
  objectConfig: ObjectDataConfiguration;
  records: any[];
}

export interface ObjectDataImportResultContext extends ObjectDataImportContext {
  result: DataImportResult;
}

export interface DataImportResultContext extends DataImportContext {
  allResults: DataImportResult[];
}

export interface DataExportContext {
  config: DataConfiguration;
}

export interface ObjectDataExportContext extends DataExportContext {
  objectConfig: ObjectDataConfiguration;
  records: any[];
}

export interface ObjectDataExportResultContext extends ObjectDataExportContext {}

export interface DataExportResultContext extends DataExportContext {}
