using ztablemaintenance.farm as db from '../db/data-model';
using { sap.changelog.ChangeView as ChangelogChangeView } from '@cap-js/change-tracking';

service DSTableMaintenanceService @(path: '/odata/v4/ds-table-maintenance') {
    entity TankVolumes
      @(restrict : [
            {
                grant : [ 'READ' ],
                to : [ 'ZTM_Display' ]
            },
            {
                grant : [ '*' ],
                to : [ 'ZTM_DataSteward', 'ZTM_DataEngineer', 'ZTM_Admin' ]
            }
             ])
      as projection on db.TankVolumes_M;

    entity PlantLocation
      @(restrict : [
            {
                grant : [ 'READ' ],
                to : [ 'ZTM_Display' ]
            },
            {
                grant : [ '*' ],
                to : [ 'ZTM_DataSteward', 'ZTM_DataEngineer', 'ZTM_Admin' ]
            }
             ])
      as projection on db.ZPLANT_LOCATION;

    entity ChangeView as projection on ChangelogChangeView;
}

service SchemaBrowserService @(path: '/odata/v4/schema-browser') {
  type SchemaType {
    name: String;
  }
  
  type SchemasResponse {
    schemas: many SchemaType;
    currentSchema: String;
  }

  type TableType {
    name: String;
    label: String;
  }

  type TablesResponse {
    schemaName: String;
    tables: many TableType;
  }

  type ColumnType {
    COLUMN_NAME: String;
    DATA_TYPE_NAME: String;
    LENGTH: Integer;
    SCALE: Integer;
    IS_NULLABLE: String;
    DEFAULT_VALUE: String;
  }

  type FieldDef {
    name: String;
    type: String;
    length: Integer;
    scale: Integer;
    isPrimary: Boolean;
    isNotNull: Boolean;
    defaultValue: String;
    comment: String;
  }
  
  type ActionResponse {
    success: Boolean;
    message: String;
  }

  function getSchemas() returns SchemasResponse;
  function getTables(schemaName: String) returns TablesResponse;
  function getColumns(tableName: String, schemaName: String) returns many ColumnType;

  action createTable(
    schemaName: String,
    tableName: String,
    tableType: String,
    tableComment: String,
    fields: many FieldDef,
    includeCuid: Boolean,
    includeManaged: Boolean,
    includeTemporal: Boolean,
    includeCodeList: Boolean
  ) returns ActionResponse;

  action dropTable(
    schemaName: String,
    tableName: String
  ) returns ActionResponse;

  action alterTable(
    schemaName: String,
    tableName: String,
    fields: many FieldDef
  ) returns ActionResponse;
}
