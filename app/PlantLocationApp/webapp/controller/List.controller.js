sap.ui.define([
    "dwcmission/plantlocationapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/ComboBox",
    "sap/m/Select",
    "sap/m/Text",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (BaseController, JSONModel, Filter, FilterOperator, MessageBox, Column, ColumnListItem, Input, Label, ComboBox, Select, Text, Item, SimpleForm) {
    "use strict";

        return BaseController.extend("dwcmission.plantlocationapp.controller.List", {
            onInit: function () {
                this.setModel(new JSONModel({
                    busy: false,
                    tables: [],
                    tableSelectItems: [
                        { key: "", text: this.getText("tableSelectPlaceholder") }
                    ],
                    filteredTables: [],
                    templateRoles: [
                        { key: "DEMAND", text: "Demand" },
                        { key: "SUPPLY", text: "Supply" },
                        { key: "BASIC_DATA", text: "Basic Data" }
                    ],
                    templateRoleItems: [
                        { key: "", text: this.getText("templateRoleSelectPlaceholder") },
                        { key: "DEMAND", text: "Demand" },
                        { key: "SUPPLY", text: "Supply" },
                        { key: "BASIC_DATA", text: "Basic Data" }
                    ],
                    selectedTemplateRole: "",
                    selectedSchema: "",
                    schemaSelectItems: [],
                    selectedTable: "",
                    schemaName: "",
                    tableTitle: this.getText("tableTitle"),
                search: "",
                selectedCount: 0,
                columns: [],
                keyColumns: [],
                rows: [],
                filteredRows: [],
                createEdit: {
                    mode: "create",
                    title: "",
                    values: {},
                    originalKeys: {}
                },
                multiUpdate: {
                    title: "",
                    instructions: "",
                    values: {}
                },
                upload: {
                    fileName: "",
                    rows: [],
                    previewText: "",
                    instructions: ""
                },
                historyBusy: false,
                filteredHistory: [],
                searchHistory: "",
                plant: "",
                entityKey: "",
                createTable: {
                    tableName: "",
                    tableType: "COLUMN",
                    tableComment: "",
                    fields: []
                },
                valueHelps: {},
                semanticTypeSuggestions: [
                    { key: "Plant", text: this.getText("semanticTypePlant") },
                    { key: "Company Code", text: this.getText("semanticTypeCompanyCode") },
                    { key: "Sales Org", text: this.getText("semanticTypeSalesOrg") }
                ]
            }), "view");

            this._loadSchemas();
        },

        onSchemaChange: function () {
            this.getModel("view").setProperty("/selectedTable", "");
            this.getModel("view").setProperty("/search", "");
            this._loadTables();
        },

        onTemplateRoleChange: function () {
            var oViewModel = this.getModel("view");

            oViewModel.setProperty("/selectedTable", "");
            oViewModel.setProperty("/search", "");
            this._applyTemplateRoleFilter();
            this._loadSelectedTable();
        },

        onTableChange: function () {
            this._setBusy(true);
            this._loadSelectedTable()
                .catch(this._handleActionError.bind(this, "tableLoadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue") || "");
            this._applyFilters();
        },

        onRefresh: function () {
            this._setBusy(true);
            this._loadSelectedTable()
                .then(function () {
                    this.showToast(this.getText("refreshTriggered"));
                }.bind(this))
                .catch(this._handleActionError.bind(this, "refreshFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onOpenJouleChat: function () {
            window.open("https://sgs-joule-dev.us21.sapdas.cloud.sap/webclient/standalone/da_agent", "_blank", "noopener,noreferrer");
        },

        onSelectionChange: function () {
            this._updateSelectionState();
        },

        onCreate: function () {
            var aColumns = this._getColumns(),
                oValues = {};

            if (!this._ensureTableSelected()) {
                return;
            }

            aColumns.forEach(function (column) {
                oValues[column.name] = "";
            });

            this.getModel("view").setProperty("/createEdit", {
                mode: "create",
                title: this.getText("createDialogTitleGeneric", [this._getSelectedTableName()]),
                values: oValues,
                originalKeys: {}
            });

            this._prepareValueHelps()
                .then(function () {
                    this._buildCreateEditForm();
                    this.byId("createEditDialog").open();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "createFailed"));
        },

        onCreateTableOpen: function () {
            this.getModel("view").setProperty("/createTable", {
                tableName: "",
                tableType: "COLUMN",
                tableComment: "",
                includeCuid: true,
                includeManaged: true,
                includeTemporal: false,
                includeCodeList: false,
                fields: []
            });
            this.byId("createTableDialog").open();
        },

        onAddTableColumn: function () {
            var aFields = this.getModel("view").getProperty("/createTable/fields") || [];
            aFields.push({
                name: "",
                semanticType: "",
                type: "NVARCHAR",
                length: 50,
                scale: null,
                isPrimary: false,
                isNotNull: false,
                referenceTable: "",
                referenceColumn: "",
                aliases: "",
                valueHelpRequired: false,
                defaultValue: "",
                comment: ""
            });
            this.getModel("view").setProperty("/createTable/fields", aFields);
        },

        onRemoveTableColumn: function (oEvent) {
            var oItem = oEvent.getParameter("listItem"),
                sPath = oItem.getBindingContext("view").getPath(),
                iIndex = parseInt(sPath.split("/").pop(), 10),
                aFields = this.getModel("view").getProperty("/createTable/fields") || [];
                
            aFields.splice(iIndex, 1);
            this.getModel("view").setProperty("/createTable/fields", aFields);
        },

        onCancelNewTable: function () {
            this.byId("createTableDialog").close();
        },

        onSaveNewTable: function () {
            var oPayload = this.getModel("view").getProperty("/createTable");

            if (!oPayload.tableName) {
                this.showToast(this.getText("tableNameRequired"));
                return;
            }

            // We no longer strictly require fields if they checked a CAP aspect like cuid or CodeList
            if ((!oPayload.fields || !oPayload.fields.length) && !oPayload.includeCuid && !oPayload.includeManaged && !oPayload.includeTemporal && !oPayload.includeCodeList) {
                this.showToast(this.getText("createTableNoFields"));
                return;
            }

            if (!this._validateTableFields(oPayload.fields || [])) {
                return;
            }

            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            if (sSelectedSchema) {
                oPayload.schemaName = sSelectedSchema;
            }

            this._setBusy(true);
            this._request("api/schema-browser/tables", {
                method: "POST",
                body: JSON.stringify(oPayload)
            })
                .then(function () {
                    this.byId("createTableDialog").close();
                    this.showToast(this.getText("createTableSuccess", [oPayload.tableName]));
                    return this._loadTables();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "createTableFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onDeleteTable: function () {
            var sTableName = this.getModel("view").getProperty("/selectedTable");
            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            if (!sTableName) return;

            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName);
            if (sSelectedSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSelectedSchema);
            }

            MessageBox.confirm(this.getText("confirmDropTable", [sTableName]), {
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        this._setBusy(true);
                        this._request(sUrl, {
                            method: "DELETE"
                        })
                            .then(function () {
                                this.showToast(this.getText("dropTableSuccess", [sTableName]));
                                this.getModel("view").setProperty("/selectedTable", "");
                                return this._loadTables();
                            }.bind(this))
                            .catch(this._handleActionError.bind(this, "dropTableFailed"))
                            .finally(function () {
                                this._setBusy(false);
                            }.bind(this));
                    }
                }.bind(this)
            });
        },

        onAlterTableOpen: function () {
            var sTableName = this.getModel("view").getProperty("/selectedTable");
            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            if (!sTableName) return;

            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/metadata";
            if (sSelectedSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSelectedSchema);
            }

            this._setBusy(true);
            this._request(sUrl)
                .then(function (oMetadata) {
                    var aFields = (oMetadata.columns || []).map(function(c) {
                        return {
                            name: c.name,
                            semanticType: c.semanticType || "",
                            type: c.type,
                            length: c.length || null,
                            scale: c.scale || null,
                            isPrimary: !!c.key,
                            isNotNull: !c.nullable,
                            referenceTable: c.referenceTable || "",
                            referenceColumn: c.referenceColumn || "",
                            aliases: c.aliases || "",
                            valueHelpRequired: !!c.valueHelpRequired,
                            defaultValue: c.DEFAULT_VALUE || "",
                            comment: "",
                            isExisting: true
                        };
                    });

                    this.getModel("view").setProperty("/alterTable", {
                        tableName: sTableName,
                        fields: aFields
                    });
                    this.byId("alterTableDialog").open();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "loadColumnsFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onAddAlterTableColumn: function () {
            var aFields = this.getModel("view").getProperty("/alterTable/fields") || [];
            aFields.push({
                name: "",
                semanticType: "",
                type: "NVARCHAR",
                length: 50,
                scale: null,
                isPrimary: false,
                isNotNull: false,
                referenceTable: "",
                referenceColumn: "",
                aliases: "",
                valueHelpRequired: false,
                defaultValue: "",
                comment: "",
                isExisting: false
            });
            this.getModel("view").setProperty("/alterTable/fields", aFields);
        },

        onRemoveAlterTableColumn: function (oEvent) {
            var oItem = oEvent.getParameter("listItem"),
                sPath = oItem.getBindingContext("view").getPath(),
                iIndex = parseInt(sPath.split("/").pop(), 10),
                aFields = this.getModel("view").getProperty("/alterTable/fields") || [];
                
            aFields.splice(iIndex, 1);
            this.getModel("view").setProperty("/alterTable/fields", aFields);
        },

        onCancelAlterTable: function () {
            this.byId("alterTableDialog").close();
        },

        onSaveAlterTable: function () {
            var oPayload = this.getModel("view").getProperty("/alterTable");

            if (!oPayload.fields || !oPayload.fields.length) {
                this.showToast(this.getText("createTableNoFields"));
                return;
            }

            if (!this._validateTableFields(oPayload.fields)) {
                return;
            }

            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            var oBody = { fields: oPayload.fields };
            if (sSelectedSchema) {
                oBody.schemaName = sSelectedSchema;
            }

            this._setBusy(true);
            this._request("api/schema-browser/tables/" + encodeURIComponent(oPayload.tableName), {
                method: "PATCH",
                body: JSON.stringify(oBody)
            })
                .then(function () {
                    this.byId("alterTableDialog").close();
                    this.showToast(this.getText("alterTableSuccess", [oPayload.tableName]));
                    return this._loadSelectedTable();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "alterTableFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onEdit: function () {
            var aRows = this._getSelectedRows(),
                oRow;

            if (aRows.length !== 1) {
                this.showToast(this.getText("selectSingleRecord"));
                return;
            }

            oRow = Object.assign({}, aRows[0]);
            this.getModel("view").setProperty("/createEdit", {
                mode: "edit",
                title: this.getText("editDialogTitleGeneric", [this._getSelectedTableName()]),
                values: oRow,
                originalKeys: this._extractKeys(oRow)
            });

            this._prepareValueHelps()
                .then(function () {
                    this._buildCreateEditForm();
                    this.byId("createEditDialog").open();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "updateFailed"));
        },

        onSaveCreateEdit: function () {
            var oViewModel = this.getModel("view"),
                oPayload = oViewModel.getProperty("/createEdit"),
                sTableName = this._getSelectedTableName(),
                oTrackedEntity = this._getTrackedEntityConfig(),
                sMethod = oPayload.mode === "create" ? "POST" : "PATCH",
                sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/rows",
                oBody,
                oSchemaBrowserBody;

            if (!this._validateCreateEdit(oPayload)) {
                return;
            }

            oSchemaBrowserBody = oPayload.mode === "create"
                ? { data: oPayload.values }
                : { keys: oPayload.originalKeys, data: oPayload.values };

            if (oTrackedEntity) {
                sUrl = this._buildTrackedEntityRequestUrl(oTrackedEntity, oPayload);
                oBody = this._buildTrackedEntityPayload(oPayload, oTrackedEntity);
            } else {
                oBody = oSchemaBrowserBody;
            }

            this._setBusy(true);
            (oTrackedEntity ? this._requestTrackedEntity(sUrl, sMethod, oBody) : this._request(sUrl, {
                method: sMethod,
                body: JSON.stringify(oBody)
            }))
                .catch(function (oError) {
                    if (!oTrackedEntity || !/not found/i.test(String(oError && oError.message || ""))) {
                        throw oError;
                    }

                    return this._request("api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/rows", {
                        method: sMethod,
                        body: JSON.stringify(oSchemaBrowserBody)
                    });
                }.bind(this))
                .then(function () {
                    this.byId("createEditDialog").close();
                    this.showToast(this.getText(
                        oPayload.mode === "create" ? "createSuccessGeneric" : "updateSuccessGeneric",
                        [sTableName]
                    ));
                    return this._loadSelectedTable();
                }.bind(this))
                .catch(this._handleActionError.bind(this, oPayload.mode === "create" ? "createFailed" : "updateFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onCancelCreateEdit: function () {
            this.byId("createEditDialog").close();
        },

        onDelete: function () {
            var aRows = this._getSelectedRows(),
                sTableName = this._getSelectedTableName(),
                oTrackedEntity = this._getTrackedEntityConfig();

            if (!aRows.length) {
                this.showToast(this.getText("selectAtLeastOne"));
                return;
            }

            MessageBox.confirm(this.getText("deleteConfirmGeneric", [aRows.length, sTableName]), {
                actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.DELETE,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.DELETE) {
                        if (oTrackedEntity) {
                            this._deleteTrackedRows(aRows, oTrackedEntity);
                        } else {
                            this._deleteSelectedRows(aRows);
                        }
                    }
                }.bind(this)
            });
        },

        _getEntityKeyString: function (oRow) {
            if (oRow && oRow.ID !== undefined) return String(oRow.ID);
            var aKeyColumns = this.getModel("view").getProperty("/keyColumns") || [];
            if (!aKeyColumns.length) return "";
            if (aKeyColumns.length === 1) return String(oRow[aKeyColumns[0]]);
            return JSON.stringify(this._extractKeys(oRow));
        },

        onOpenChangeHistory: function () {
            var aRows = this._getSelectedRows(),
                oRow;

            if (aRows.length !== 1) {
                this.showToast(this.getText("selectSingleRecord"));
                return;
            }

            oRow = aRows[0];

            var sEntityKey = this._getTrackedEntityKeyValue(oRow) || this._getEntityKeyString(oRow);

            this.getModel("view").setProperty("/plant", sEntityKey);
            this.getModel("view").setProperty("/entityKey", sEntityKey);
            this.getModel("view").setProperty("/searchHistory", "");
            this._openChangeHistoryDialog()
                .then(function () {
                    return this._loadChangeHistory(sEntityKey);
                }.bind(this));
        },

        onCloseChangeHistory: function () {
            var oDialog = this.byId("changeHistoryDialog");

            if (oDialog) {
                oDialog.close();
            }
        },

        onSearchChangeHistory: function (oEvent) {
            this.getModel("view").setProperty("/searchHistory", oEvent.getParameter("newValue") || "");
            this._applyChangeHistoryFilters();
        },

        onOpenMultiUpdate: function () {
            var aRows = this._getSelectedRows(),
                oValues = {};

            if (aRows.length < 2) {
                this.showToast(this.getText("selectMultipleRecords"));
                return;
            }

            this._getEditableColumns().forEach(function (column) {
                oValues[column.name] = "";
            });

            this.getModel("view").setProperty("/multiUpdate", {
                title: this.getText("multiUpdateDialogTitleGeneric", [this._getSelectedTableName()]),
                instructions: this.getText("multiUpdateHintGeneric"),
                values: oValues
            });

            this._prepareValueHelps()
                .then(function () {
                    this._buildMultiUpdateForm();
                    this.byId("multiUpdateDialog").open();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "multiUpdateFailed"));
        },

        onApplyMultiUpdate: function () {
            var oValues = this.getModel("view").getProperty("/multiUpdate/values"),
                aRows = this._getSelectedRows(),
                sTableName = this._getSelectedTableName();

            if (!this._hasValues(oValues)) {
                this.showToast(this.getText("enterBulkChange"));
                return;
            }

            this._setBusy(true);
            this._request("api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/mass-update", {
                method: "POST",
                body: JSON.stringify({
                    rows: aRows.map(this._extractKeys.bind(this)),
                    data: oValues
                })
            })
                .then(function () {
                    this.byId("multiUpdateDialog").close();
                    this.showToast(this.getText("multiUpdateSuccessGeneric", [aRows.length, sTableName]));
                    return this._loadSelectedTable();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "multiUpdateFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onCancelMultiUpdate: function () {
            this.byId("multiUpdateDialog").close();
        },

        onOpenMassUpload: function () {
            this.getModel("view").setProperty("/upload", {
                fileName: "",
                rows: [],
                previewText: "",
                instructions: this.getText("uploadInstructionsGeneric")
            });
            this.byId("massUploadDialog").open();
        },

        onMassUploadFileChange: function (oEvent) {
            var aFiles = oEvent.getParameter("files"),
                oFile = aFiles && aFiles[0];

            if (!oFile) {
                return;
            }

            this._readCsvFile(oFile)
                .then(function (sContent) {
                    var aRows = this._parseCsv(sContent);

                    this.getModel("view").setProperty("/upload", {
                        fileName: oFile.name,
                        rows: aRows,
                        previewText: this.getText("uploadPreviewRowsGeneric", [aRows.length]),
                        instructions: this.getText("uploadInstructionsGeneric")
                    });
                }.bind(this))
                .catch(this._handleActionError.bind(this, "uploadReadFailed"));
        },

        onDownloadTemplate: function () {
            var sTemplate = this._getMassUploadColumns().map(function (column) {
                return column.name;
            }).join(",") + "\n",
                oBlob = new Blob([sTemplate], { type: "text/csv;charset=utf-8" }),
                sUrl = URL.createObjectURL(oBlob),
                oLink = document.createElement("a");

            oLink.href = sUrl;
            oLink.download = (this._getSelectedTableName() || "table").toLowerCase() + "-template.csv";
            oLink.click();
            URL.revokeObjectURL(sUrl);
        },

        onStartMassUpload: function () {
            var aRows = this.getModel("view").getProperty("/upload/rows") || [],
                aRequiredKeyColumns = this._getRequiredUploadKeyColumns(),
                aValidRows = aRows.filter(function (row) {
                    return this._isMassUploadRowValid(row, aRequiredKeyColumns);
                }.bind(this)),
                sTableName = this._getSelectedTableName();

            if (!aValidRows.length) {
                this.showToast(this.getText("uploadNoRows"));
                return;
            }

            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/mass-upload";
            if (sSelectedSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSelectedSchema);
            }

            this._setBusy(true);
            this._request(sUrl, {
                method: "POST",
                body: JSON.stringify({ rows: aValidRows })
            })
                .then(function () {
                    this.byId("massUploadDialog").close();
                    this.showToast(this.getText("uploadSuccessGeneric", [aValidRows.length, sTableName]));
                    return this._loadSelectedTable();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "uploadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onCancelMassUpload: function () {
            this.byId("massUploadDialog").close();
        },

        _loadSchemas: function () {
            this._setBusy(true);
            return this._request("api/schema-browser/schemas")
                .then(function (oResult) {
                    var oViewModel = this.getModel("view");
                    oViewModel.setProperty("/schemaSelectItems", oResult.schemas || []);
                    oViewModel.setProperty("/selectedSchema", oResult.currentSchema || "");
                    oViewModel.setProperty("/schemaName", oResult.currentSchema || "");
                    return this._loadTables();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "schemasLoadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _loadTables: function () {
            this._setBusy(true);
            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            var sUrl = "api/schema-browser/tables";
            if (sSelectedSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSelectedSchema);
            }

            return this._request(sUrl)
                .then(function (oResult) {
                    var oViewModel = this.getModel("view"),
                        aTables = oResult.tables || [];

                    oViewModel.setProperty("/tables", aTables);
                    oViewModel.setProperty("/schemaName", oResult.schemaName || "");
                    this._applyTemplateRoleFilter();

                    this._setTableState({
                        columns: [],
                        keyColumns: [],
                        rows: [],
                        count: 0
                    });
                    return undefined;
                }.bind(this))
                .catch(this._handleActionError.bind(this, "tablesLoadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _applyTemplateRoleFilter: function () {
            var oViewModel = this.getModel("view"),
                aTables = oViewModel.getProperty("/tables") || [],
                sSelectedTemplateRole = oViewModel.getProperty("/selectedTemplateRole"),
                aFilteredTables = sSelectedTemplateRole ? aTables : [],
                aTableSelectItems = [{
                    key: "",
                    text: this.getText("tableSelectPlaceholder")
                }].concat(aFilteredTables.map(function (oTable) {
                    return {
                        key: oTable.name,
                        text: oTable.label
                    };
                })),
                sSelectedTable = oViewModel.getProperty("/selectedTable"),
                bTableStillAvailable = aFilteredTables.some(function (oTable) {
                    return oTable.name === sSelectedTable;
                });

            oViewModel.setProperty("/filteredTables", aFilteredTables);
            oViewModel.setProperty("/tableSelectItems", aTableSelectItems);

            if (!bTableStillAvailable) {
                oViewModel.setProperty("/selectedTable", "");
            }
        },

        _loadSelectedTable: function () {
            var sTableName = this._getSelectedTableName(),
                sSearch = this.getModel("view").getProperty("/search"),
                sSelectedSchema = this.getModel("view").getProperty("/selectedSchema"),
                sUrl;

            if (!sTableName) {
                this._setTableState({
                    columns: [],
                    keyColumns: [],
                    rows: [],
                    count: 0
                });
                return Promise.resolve();
            }

            sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/rows";
            var aParams = [];
            if (sSelectedSchema) {
                aParams.push("schemaName=" + encodeURIComponent(sSelectedSchema));
            }
            if (sSearch) {
                aParams.push("search=" + encodeURIComponent(sSearch));
            }
            if (aParams.length > 0) {
                sUrl += "?" + aParams.join("&");
            }

            return this._request(sUrl).then(function (oResult) {
                this._setTableState(oResult);
            }.bind(this));
        },

        _setTableState: function (oResult) {
            var oViewModel = this.getModel("view");

            oViewModel.setProperty("/columns", oResult.columns || []);
            oViewModel.setProperty("/keyColumns", oResult.keyColumns || []);
            oViewModel.setProperty("/rows", oResult.rows || []);
            oViewModel.setProperty("/selectedCount", 0);
            oViewModel.setProperty(
                "/tableTitle",
                this.getText("tableTitleGeneric", [
                    this._getSelectedTableName() || this.getText("tableTitle"),
                    typeof oResult.count === "number" ? oResult.count : (oResult.rows || []).length
                ])
            );

            this._rebuildTable();
            this._applyFilters();
        },

        _rebuildTable: function () {
            var oTable = this.byId("plantTable"),
                aColumns = this._getColumns(),
                oTemplate;

            oTable.removeSelections(true);
            oTable.destroyColumns();
            oTable.unbindItems();

            aColumns.forEach(function (column) {
                oTable.addColumn(new Column({
                    header: new Text({
                        text: column.name
                    })
                }));
            });

            oTemplate = new ColumnListItem({
                type: "Inactive",
                cells: aColumns.map(function (column) {
                    return new Text({
                        text: {
                            path: "view>" + column.name,
                            formatter: this._formatCellValue.bind(this)
                        }
                    });
                }.bind(this))
            });

            oTable.bindItems({
                path: "view>/filteredRows",
                template: oTemplate
            });
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view"),
                aRows = oViewModel.getProperty("/rows") || [],
                aColumns = this._getColumns(),
                sSearch = (oViewModel.getProperty("/search") || "").toLowerCase(),
                aFilteredRows;

            if (!sSearch) {
                aFilteredRows = aRows;
            } else {
                aFilteredRows = aRows.filter(function (row) {
                    return aColumns.some(function (column) {
                        return String(row[column.name] ?? "").toLowerCase().indexOf(sSearch) > -1;
                    });
                });
            }

            oViewModel.setProperty("/filteredRows", aFilteredRows);
            oViewModel.setProperty(
                "/tableTitle",
                this.getText("tableTitleGeneric", [
                    this._getSelectedTableName() || this.getText("tableTitle"),
                    aFilteredRows.length
                ])
            );
            this._updateSelectionState();
        },

        _buildCreateEditForm: function () {
            var oFormBox = this.byId("createEditFieldsBox"),
                oData = this.getModel("view").getProperty("/createEdit"),
                bCreate = oData.mode === "create",
                oForm = new SimpleForm({
                    editable: true,
                    layout: "ResponsiveGridLayout",
                    columnsM: 1,
                    columnsL: 1
                });

            oFormBox.removeAllItems();
            this._getColumns().forEach(function (column) {
                if (bCreate && this._isManagedColumn(column.name)) {
                    return;
                }

                oForm.addContent(new Label({ text: column.name }));
                if (this._isValueHelpColumn(column)) {
                    oForm.addContent(new Select({
                        selectedKey: "{view>/createEdit/values/" + column.name + "}",
                        enabled: bCreate ? true : !column.key && !this._isManagedColumn(column.name),
                        forceSelection: false,
                        change: this._onValueHelpSelectionChange.bind(this, "createEdit", column),
                        items: {
                            path: "view>/valueHelps/" + column.name,
                            template: new Item({
                                key: "{view>key}",
                                text: "{view>text}"
                            })
                        }
                    }));
                } else {
                    oForm.addContent(new Input({
                        value: "{view>/createEdit/values/" + column.name + "}",
                        editable: bCreate ? true : !column.key && !this._isManagedColumn(column.name)
                    }));
                }
            }.bind(this));
            oFormBox.addItem(oForm);
        },

        onFieldSemanticTypeChange: function (oEvent) {
            var sSemanticType = String(oEvent.getSource().getValue ? oEvent.getSource().getValue() : oEvent.getSource().getSelectedKey() || "").trim(),
                oContext = oEvent.getSource().getBindingContext("view"),
                sBasePath = oContext && oContext.getPath(),
                oPreset = this._getSemanticTypePreset(sSemanticType);

            if (!sBasePath) {
                return;
            }

            this.getModel("view").setProperty(sBasePath + "/semanticType", sSemanticType);

            if (!sSemanticType) {
                this.getModel("view").setProperty(sBasePath + "/valueHelpRequired", false);
                return;
            }

            this._applySemanticTypeDefaults(sBasePath, sSemanticType, oPreset);
            this._populateSchemaValueHelpMapping(sBasePath, sSemanticType);
        },

        _buildMultiUpdateForm: function () {
            var oFormBox = this.byId("multiUpdateFieldsBox"),
                oForm = new SimpleForm({
                    editable: true,
                    layout: "ResponsiveGridLayout",
                    columnsM: 1,
                    columnsL: 1
                });

            oFormBox.removeAllItems();
            this._getEditableColumns().forEach(function (column) {
                oForm.addContent(new Label({ text: column.name }));
                if (this._isValueHelpColumn(column)) {
                    oForm.addContent(new Select({
                        selectedKey: "{view>/multiUpdate/values/" + column.name + "}",
                        forceSelection: false,
                        change: this._onValueHelpSelectionChange.bind(this, "multiUpdate", column),
                        items: {
                            path: "view>/valueHelps/" + column.name,
                            template: new Item({
                                key: "{view>key}",
                                text: "{view>text}"
                            })
                        }
                    }));
                } else {
                    oForm.addContent(new Input({
                        value: "{view>/multiUpdate/values/" + column.name + "}"
                    }));
                }
            });
            oFormBox.addItem(oForm);
        },

        _prepareValueHelps: function () {
            var oViewModel = this.getModel("view"),
                aColumns = this._getColumns().filter(this._isValueHelpColumn.bind(this)),
                oValueHelps = {};

            if (!aColumns.length) {
                oViewModel.setProperty("/valueHelps", {});
                return Promise.resolve();
            }

            return Promise.all(aColumns.map(function (column) {
                return this._requestValueHelpForColumn(column).then(function (aValues) {
                    oValueHelps[column.name] = aValues;
                });
            }.bind(this))).then(function () {
                oViewModel.setProperty("/valueHelps", oValueHelps);
            });
        },

        _requestValueHelpForColumn: function (oColumn) {
            var sTableName = this._getSelectedTableName(),
                sSelectedSchema = this.getModel("view").getProperty("/selectedSchema"),
                sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/value-help/" + encodeURIComponent(oColumn.name);

            if (sSelectedSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSelectedSchema);
            }

            return this._request(sUrl).then(function (oResult) {
                var aValues = [{ key: "", text: this.getText("valueHelpSelectEmpty") }].concat(oResult.values || []);

                return aValues;
            }.bind(this));
        },

        _isValueHelpColumn: function (oColumn) {
            return !!(oColumn && oColumn.valueHelpRequired && oColumn.referenceTable && oColumn.referenceColumn);
        },

        _onValueHelpSelectionChange: function (sModelPath, oColumn, oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem"),
                oSelectedContext = oSelectedItem && oSelectedItem.getBindingContext("view"),
                oSelectedValue = oSelectedContext && oSelectedContext.getObject(),
                sDescriptionTarget = this._findDescriptionTargetColumn(oColumn),
                sTargetPath;

            if (!sDescriptionTarget) {
                return;
            }

            sTargetPath = "/" + sModelPath + "/values/" + sDescriptionTarget;
            this.getModel("view").setProperty(sTargetPath, oSelectedValue && oSelectedValue.description ? oSelectedValue.description : "");
        },

        _findDescriptionTargetColumn: function (oColumn) {
            var aColumns = this._getColumns(),
                sName = String(oColumn && oColumn.name || "").toUpperCase(),
                aCandidates = [
                    sName + "_NAME",
                    sName + "_DESC",
                    sName + "_DESCRIPTION",
                    sName.replace(/_CODE$/, "_NAME"),
                    sName.replace(/_ID$/, "_NAME")
                ];

            return (aColumns.find(function (column) {
                return aCandidates.indexOf(String(column.name || "").toUpperCase()) > -1;
            }) || {}).name || "";
        },

        _validateTableFields: function (aFields) {
            var bHasInvalidField = (aFields || []).some(function (field) {
                return !field.name;
            });

            if (bHasInvalidField) {
                this.showToast(this.getText("fieldNameRequired"));
                return false;
            }

            var bHasInvalidReference = (aFields || []).some(function (field) {
                return this._hasBusinessTypeMetadata(field) && (!field.referenceTable || !field.referenceColumn);
            }.bind(this));

            if (bHasInvalidReference) {
                this.showToast(this.getText("fieldReferenceRequired"));
                return false;
            }

            return true;
        },

        _hasBusinessTypeMetadata: function (oField) {
            return !!String(oField.semanticType || oField.referenceTable || oField.referenceColumn || "").trim();
        },

        _getSemanticTypePreset: function (sSemanticType) {
            var mPresets = {
                PLANT: {
                    name: "PLANT",
                    type: "NVARCHAR",
                    length: 4,
                    scale: null,
                    referenceColumn: "PLANT",
                    comment: "Plant"
                },
                COMPANYCODE: {
                    name: "COMPANY_CODE",
                    type: "NVARCHAR",
                    length: 4,
                    scale: null,
                    referenceColumn: "COMPANY_CODE",
                    comment: "Company Code"
                },
                SALESORG: {
                    name: "SALES_ORG",
                    type: "NVARCHAR",
                    length: 4,
                    scale: null,
                    referenceColumn: "SALES_ORG",
                    comment: "Sales Organization"
                }
            };

            return mPresets[this._getSemanticKey(sSemanticType)] || null;
        },

        _getSemanticKey: function (sSemanticType) {
            return String(sSemanticType || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        },

        _getSemanticFieldName: function (sSemanticType) {
            return String(sSemanticType || "")
                .trim()
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "");
        },

        _applySemanticTypeDefaults: function (sBasePath, sSemanticType, oPreset) {
            if (!oPreset) {
                this.getModel("view").setProperty(sBasePath + "/name", this.getModel("view").getProperty(sBasePath + "/name") || this._getSemanticFieldName(sSemanticType));
                this.getModel("view").setProperty(sBasePath + "/referenceColumn", this.getModel("view").getProperty(sBasePath + "/referenceColumn") || this._getSemanticFieldName(sSemanticType));
                this.getModel("view").setProperty(sBasePath + "/aliases", this.getModel("view").getProperty(sBasePath + "/aliases") || this._getSemanticFieldName(sSemanticType));
                this.getModel("view").setProperty(sBasePath + "/valueHelpRequired", true);
                this.getModel("view").setProperty(sBasePath + "/comment", this.getModel("view").getProperty(sBasePath + "/comment") || sSemanticType);
                return;
            }

            this.getModel("view").setProperty(sBasePath + "/name", this.getModel("view").getProperty(sBasePath + "/name") || oPreset.name);
            this.getModel("view").setProperty(sBasePath + "/type", oPreset.type);
            this.getModel("view").setProperty(sBasePath + "/length", oPreset.length);
            this.getModel("view").setProperty(sBasePath + "/scale", oPreset.scale);
            this.getModel("view").setProperty(sBasePath + "/referenceColumn", oPreset.referenceColumn);
            this.getModel("view").setProperty(sBasePath + "/aliases", this.getModel("view").getProperty(sBasePath + "/aliases") || [oPreset.name, oPreset.referenceColumn].filter(Boolean).join(", "));
            this.getModel("view").setProperty(sBasePath + "/valueHelpRequired", true);
            this.getModel("view").setProperty(sBasePath + "/comment", this.getModel("view").getProperty(sBasePath + "/comment") || oPreset.comment);
        },

        _populateSchemaValueHelpMapping: function (sBasePath, sSemanticType) {
            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema"),
                sUrl = "api/schema-browser/value-help-config/" + encodeURIComponent(sSemanticType);

            if (sSelectedSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSelectedSchema);
            }

            this._request(sUrl)
                .then(function (oConfig) {
                    if (!oConfig || !oConfig.referenceTable || !oConfig.referenceColumn) {
                        return;
                    }

                    this.getModel("view").setProperty(sBasePath + "/referenceTable", oConfig.referenceTable);
                    this.getModel("view").setProperty(sBasePath + "/referenceColumn", oConfig.referenceColumn);

                    if (oConfig.aliases) {
                        this.getModel("view").setProperty(sBasePath + "/aliases", oConfig.aliases);
                    }
                }.bind(this))
                .catch(function () {
                    // Keep manual entry fallback when no schema-level mapping exists yet.
                });
        },

        _deleteSelectedRows: function (aRows) {
            var sTableName = this._getSelectedTableName();
            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");

            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/rows";
            if (sSelectedSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSelectedSchema);
            }

            this._setBusy(true);
            Promise.all(aRows.map(function (row) {
                return this._request(sUrl, {
                    method: "DELETE",
                    body: JSON.stringify({
                        keys: this._extractKeys(row)
                    })
                });
            }.bind(this)))
                .then(function () {
                    this.showToast(this.getText("deleteSuccessGeneric", [aRows.length, sTableName]));
                    return this._loadSelectedTable();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "deleteFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _deleteTrackedRows: function (aRows, oConfig) {
            this._setBusy(true);
            Promise.all(aRows.map(function (oRow) {
                return this._requestTrackedEntity(
                    "/odata/v4/farm-tank/" + oConfig.entityName + this._buildODataKeyPredicate(oConfig, oRow),
                    "DELETE"
                );
            }.bind(this)))
                .then(function () {
                    this.showToast(this.getText("deleteSuccessGeneric", [aRows.length, this._getSelectedTableName()]));
                    return this._loadSelectedTable();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "deleteFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _validateCreateEdit: function (oPayload) {
            var aKeyColumns = this.getModel("view").getProperty("/keyColumns") || [];

            if (oPayload.mode === "create" && !aKeyColumns.every(function (key) {
                if (this._isManagedColumn(key)) {
                    return true;
                }
                return !!oPayload.values[key];
            }.bind(this))) {
                this.showToast(this.getText("requiredKeyFieldsMissing"));
                return false;
            }

            return true;
        },

        _extractKeys: function (oRow) {
            var oKeys = {};

            (this.getModel("view").getProperty("/keyColumns") || []).forEach(function (key) {
                oKeys[key] = oRow[key];
            });

            return oKeys;
        },

        _getSelectedRows: function () {
            return this.byId("plantTable").getSelectedContexts().map(function (context) {
                return Object.assign({}, context.getObject());
            });
        },

        _getColumns: function () {
            return this.getModel("view").getProperty("/columns") || [];
        },

        _getEditableColumns: function () {
            return this._getColumns().filter(function (column) {
                return !column.key && !this._isManagedColumn(column.name);
            }.bind(this));
        },

        _getMassUploadColumns: function () {
            return this._getColumns().filter(function (column) {
                return !this._isManagedColumn(column.name);
            }.bind(this));
        },

        _getRequiredUploadKeyColumns: function () {
            return (this.getModel("view").getProperty("/keyColumns") || []).filter(function (key) {
                return !this._isManagedColumn(key);
            }.bind(this));
        },

        _isMassUploadRowValid: function (oRow, aRequiredKeyColumns) {
            var aUploadColumns = this._getMassUploadColumns(),
                fnHasValue = function (value) {
                    return value !== undefined && value !== null && value !== "";
                },
                bHasRequiredKeys = (aRequiredKeyColumns || []).every(function (key) {
                    return fnHasValue(oRow[key]);
                }),
                bHasData = aUploadColumns.some(function (column) {
                    return fnHasValue(oRow[column.name]);
                });

            return bHasRequiredKeys && bHasData;
        },

        _isManagedColumn: function (sColumnName) {
            var sNormalized = String(sColumnName || "").toUpperCase();

            return ["ID", "CREATEDAT", "CREATEDBY", "MODIFIEDAT", "MODIFIEDBY"].indexOf(sNormalized) > -1;
        },

        _getSelectedTableName: function () {
            return this.getModel("view").getProperty("/selectedTable");
        },

        _getTrackedEntityConfig: function () {
            var sTableName = String(this._getSelectedTableName() || "").toUpperCase();

            if (sTableName.indexOf("ZPLANT_LOCATION") > -1) {
                return {
                    entityName: "PlantLocation",
                    keyColumn: "PLANT"
                };
            }

            if (sTableName.indexOf("TANK_VOLUMES") > -1 || sTableName.indexOf("TANKVOLUMES") > -1) {
                return {
                    entityName: "TankVolumes",
                    keyColumn: "TANK_ID"
                };
            }

            return null;
        },

        _getTrackedEntityKeyValue: function (oRow) {
            var oConfig = this._getTrackedEntityConfig();

            if (!oConfig || !oRow) {
                return "";
            }

            return oRow[oConfig.keyColumn] || "";
        },

        _buildTrackedEntityRequestUrl: function (oConfig, oPayload) {
            var sBaseUrl = "/odata/v4/farm-tank/" + oConfig.entityName;

            if (oPayload.mode === "create") {
                return sBaseUrl;
            }

            return sBaseUrl + this._buildODataKeyPredicate(oConfig, oPayload.originalKeys || oPayload.values || {});
        },

        _buildTrackedEntityPayload: function (oPayload, oConfig) {
            var oSanitized = {};

            this._getColumns().forEach(function (column) {
                var sName = column.name;

                if (this._isManagedColumn(sName)) {
                    return;
                }

                if (oPayload.mode !== "create" && column.key) {
                    return;
                }

                if (oPayload.values[sName] !== undefined && oPayload.values[sName] !== null && oPayload.values[sName] !== "") {
                    oSanitized[sName] = oPayload.values[sName];
                }
            }.bind(this));

            if (oPayload.mode === "create" && oConfig.keyColumn && oPayload.values[oConfig.keyColumn] !== undefined) {
                oSanitized[oConfig.keyColumn] = oPayload.values[oConfig.keyColumn];
            }

            return oSanitized;
        },

        _buildODataKeyPredicate: function (oConfig, oValues) {
            var oKeyColumn = this._getColumns().find(function (column) {
                    return column.name === oConfig.keyColumn;
                }) || {},
                aKeyColumns = this.getModel("view").getProperty("/keyColumns") || [],
                vKeyValue = oValues[oConfig.keyColumn];

            if (vKeyValue === undefined || vKeyValue === null || vKeyValue === "") {
                throw new Error(this.getText("requiredKeyFieldsMissing"));
            }

            var sFormattedValue = this._formatODataKeyValue(vKeyValue, oKeyColumn.type);

            return "(" + oConfig.keyColumn + "=" + sFormattedValue + ")";
        },

        _formatODataKeyValue: function (vValue, sType) {
            var sColumnType = String(sType || "").toUpperCase();

            if (["INTEGER", "INT", "SMALLINT", "BIGINT", "DECIMAL", "DOUBLE", "REAL", "FLOAT", "NUMBER"].indexOf(sColumnType) > -1) {
                return String(vValue);
            }

            if (sColumnType === "BOOLEAN") {
                return String(vValue).toLowerCase() === "true" ? "true" : "false";
            }

            if (sColumnType === "UUID" || sColumnType === "GUID") {
                return String(vValue);
            }

            return "'" + encodeURIComponent(String(vValue).replace(/'/g, "''")) + "'";
        },

        _getCsrfToken: function () {
            if (!this._csrfTokenPromise) {
                this._csrfTokenPromise = fetch("/odata/v4/farm-tank/", {
                    method: "GET",
                    credentials: "same-origin",
                    headers: {
                        "Accept": "application/json",
                        "x-csrf-token": "Fetch"
                    }
                }).then(function (response) {
                    var sToken = response.headers.get("x-csrf-token");

                    if (!sToken) {
                        throw new Error("Failed to obtain CSRF token.");
                    }

                    return sToken;
                }).catch(function (error) {
                    this._csrfTokenPromise = null;
                    throw error;
                }.bind(this));
            }

            return this._csrfTokenPromise;
        },

        _requestTrackedEntity: function (sUrl, sMethod, oBody) {
            return this._getCsrfToken().then(function (sToken) {
                var oOptions = {
                    method: sMethod,
                    credentials: "same-origin",
                    headers: {
                        "Accept": "application/json",
                        "x-csrf-token": sToken
                    }
                };

                if (sMethod !== "POST") {
                    oOptions.headers["If-Match"] = "*";
                }

                if (oBody) {
                    oOptions.headers["Content-Type"] = "application/json";
                    oOptions.body = JSON.stringify(oBody);
                }

                return fetch(sUrl, oOptions).then(function (response) {
                    return response.text().then(function (text) {
                        var payload = {};

                        try {
                            payload = text ? JSON.parse(text) : {};
                        } catch (e) {
                            payload = {};
                        }

                        if (!response.ok) {
                            throw new Error(
                                payload.error?.message
                                || payload.error
                                || text
                                || response.statusText
                                || "Request failed"
                            );
                        }

                        return payload;
                    });
                });
            }.bind(this));
        },

        _setBusy: function (bBusy) {
            this.getModel("view").setProperty("/busy", bBusy);
            this.getView().setBusy(bBusy);
        },

        _openChangeHistoryDialog: function () {
            var oView = this.getView();

            if (this.byId("changeHistoryDialog")) {
                return Promise.resolve().then(function () {
                    oView.byId("changeHistoryDialog").open();
                });
            }

            return this.loadFragment({
                name: "dwcmission.plantlocationapp.fragment.ChangeHistoryDialog"
            }).then(function (oDialog) {
                oView.addDependent(oDialog);
                oDialog.open();
            });
        },

        _loadChangeHistory: function (sEntityKey) {
            var oModel = this.getOwnerComponent().getModel(),
                aFilters = [
                    new Filter({
                        filters: [
                            new Filter("entityKey", FilterOperator.EQ, sEntityKey),
                            new Filter("objectID", FilterOperator.EQ, sEntityKey),
                            new Filter("keys", FilterOperator.Contains, sEntityKey)
                        ],
                        and: false
                    })
                ],
                oListBinding;

            this.getModel("view").setProperty("/historyBusy", true);

            oListBinding = oModel.bindList("/ChangeView", undefined, undefined, aFilters);

            return oListBinding.requestContexts(0, 200)
                .then(function (aContexts) {
                    var aHistory = (aContexts || []).map(function (oContext) {
                        return oContext.getObject();
                    });

                    this.getModel("view").setProperty("/plantHistory", aHistory);
                    this._applyChangeHistoryFilters();
                }.bind(this))
                .catch(function () {
                    this.getModel("view").setProperty("/plantHistory", []);
                    this.getModel("view").setProperty("/filteredHistory", []);
                }.bind(this))
                .finally(function () {
                    this.getModel("view").setProperty("/historyBusy", false);
                }.bind(this));
        },

        _applyChangeHistoryFilters: function () {
            var oViewModel = this.getModel("view"),
                aHistory = oViewModel.getProperty("/plantHistory") || [],
                sSearch = (oViewModel.getProperty("/searchHistory") || "").toLowerCase(),
                aFiltered;

            if (!sSearch) {
                aFiltered = aHistory;
            } else {
                aFiltered = aHistory.filter(function (oRow) {
                    return [
                        oRow.modification,
                        oRow.entity,
                        oRow.objectID,
                        oRow.attribute,
                        oRow.valueChangedTo,
                        oRow.valueChangedFrom,
                        oRow.createdBy,
                        oRow.createdAt
                    ].some(function (v) {
                        return String(v ?? "").toLowerCase().indexOf(sSearch) > -1;
                    });
                });
            }

            oViewModel.setProperty("/filteredHistory", aFiltered);
        },

        _updateSelectionState: function () {
            this.getModel("view").setProperty("/selectedCount", this.byId("plantTable").getSelectedContexts().length);
        },

        _ensureTableSelected: function () {
            if (!this._getSelectedTableName()) {
                this.showToast(this.getText("noTableSelected"));
                return false;
            }

            return true;
        },

        _hasValues: function (oValues) {
            return Object.keys(oValues || {}).some(function (key) {
                return oValues[key] !== undefined && oValues[key] !== null && oValues[key] !== "";
            });
        },

        _readCsvFile: function (oFile) {
            return new Promise(function (resolve, reject) {
                var oReader = new FileReader();

                oReader.onload = function (oEvent) {
                    resolve(oEvent.target.result);
                };
                oReader.onerror = reject;
                oReader.readAsText(oFile);
            });
        },

        _parseCsv: function (sContent) {
            var aLines = sContent.split(/\r?\n/).filter(Boolean),
                aHeaders,
                aRows;

            if (aLines.length < 2) {
                return [];
            }

            aHeaders = aLines[0].split(",").map(function (header) {
                return header.trim();
            });

            aRows = aLines.slice(1).map(function (line) {
                var aValues = line.split(","),
                    oRow = {};

                aHeaders.forEach(function (header, index) {
                    oRow[header] = (aValues[index] || "").trim();
                });

                return oRow;
            });

            return aRows;
        },

        _formatCellValue: function (value) {
            if (value === null || value === undefined) {
                return "";
            }
            return String(value);
        },

        _request: function (sUrl, oOptions) {
            var oRequestOptions = Object.assign({
                headers: {
                    "Accept": "application/json"
                }
            }, oOptions || {});

            if (oRequestOptions.body) {
                oRequestOptions.headers["Content-Type"] = "application/json";
            }

            return fetch(sUrl, oRequestOptions).then(function (response) {
                return response.json().catch(function () {
                    return {};
                }).then(function (payload) {
                    if (!response.ok) {
                        throw new Error(payload.error || response.statusText);
                    }
                    return payload;
                });
            });
        },

        _handleActionError: function (sMessageKey, oError) {
            this.showError(this.getText(sMessageKey), oError && (oError.message || oError.toString()));
        }
    });
});
