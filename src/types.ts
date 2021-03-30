export interface ObjectDataConfiguration {
  query?: string;
  externalid?: string;
  directory?: string;
  filename?: string;
  cleanupFields?: string[];
  hasRecordTypes?: boolean;
  enableMultiThreading?: boolean;
}

export interface PluginConfiguration {
    import?: string;
    export?: string;
    tsResolveBaseDir?: string;
}

export interface DataConfiguration {
  plugin?: PluginConfiguration;
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
}

export interface ObjectDataImportContext extends DataImportContext {
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

export interface DataImportPlugin {
  onBeforeImport(context: DataImportContext): Promise<void>;
  onBeforeImportObject(context: ObjectDataImportContext): Promise<void>;
  onAfterImportObject(context: ObjectDataImportResultContext): Promise<void>;
  onAfterImport(context: DataImportResultContext): Promise<void>;
}

export interface DataExportPlugin {
  onBeforeExport(context: DataExportContext): Promise<void>;
  onBeforeExportObject(context: ObjectDataExportContext): Promise<void>;
  onAfterExportObject(context: ObjectDataExportResultContext): Promise<void>;
  onAfterExport(context: DataExportResultContext): Promise<void>;
}
