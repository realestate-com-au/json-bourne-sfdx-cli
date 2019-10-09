export class CPQDataImportRequest {

  public sObjectType: String;
  public operation: String;
  public payload: Array<any>;
  public extIdField: String;

  constructor(sObjectType: String, operation: String, payload: Array<any>, extIdField: String) {
    this.sObjectType = sObjectType;
    this.operation = operation;
    this.payload = payload;
    this.extIdField = extIdField;
  }
}
