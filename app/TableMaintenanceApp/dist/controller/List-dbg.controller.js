sap.ui.define([
    "ztm/tmapp/controller/BaseController",
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
    "sap/ui/layout/form/SimpleForm",
    "sap/ui/export/Spreadsheet"
], function (BaseController, JSONModel, Filter, FilterOperator, MessageBox, Column, ColumnListItem, Input, Label, ComboBox, Select, Text, Item, SimpleForm, Spreadsheet) {
    "use strict";

        return BaseController.extend("ztm.tmapp.controller.List", {
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
                    tableSubtitle: this.getText("workspaceSelectTableHint"),
                    heroSubtitle: this.getText("workspaceHeroSubtitle"),
                    accessRoleLabel: this.getText("workspaceRoleUnknown"),
                    accessModeLabel: this.getText("workspaceModeEdit"),
                    accessModeState: "Success",
                    canMaintain: false,
                    isReadOnlyRole: false,
                    search: "",
                    selectedCount: 0,
                    rowCount: 0,
                    rowCountText: "0",
                    visibleColumnCount: 0,
                    columnCountText: this.getText("workspaceColumnsCount", [0]),
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

            this._bindShellRoleState();
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

        onTableValueHelp: function () {
            this.byId("tableSelectDialog").open();
        },

        onTableSelectSearch: function (oEvent) {
            var sValue = oEvent.getParameter("value");
            var oFilter = new Filter("text", FilterOperator.Contains, sValue);
            var oBinding = oEvent.getParameter("itemsBinding");
            oBinding.filter([oFilter]);
        },

        onTableSelectConfirm: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            if (oSelectedItem) {
                this.getModel("view").setProperty("/selectedTable", oSelectedItem.getDescription());
                this.onTableChange();
            }
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

        onExportExcel: function () {
            var aCols = [],
                aRows = this.getModel("view").getProperty("/filteredRows") || [],
                sTableName = this._getSelectedTableName();

            if (!aRows.length) {
                this.showToast(this.getText("noDataToExport"));
                return;
            }

            this._getColumns().forEach(function (col) {
                aCols.push({
                    label: col.name,
                    property: col.name,
                    type: "string"
                });
            });

            var oSettings = {
                workbook: { columns: aCols },
                dataSource: aRows,
                fileName: (sTableName || "Export") + ".xlsx"
            };

            new Spreadsheet(oSettings).build();
        },

        onOpenJouleChat: function () {
            window.open("https://sgs-joule-dev.us21.sapdas.cloud.sap/webclient/standalone/da_agent", "_blank", "noopener,noreferrer");
        },

        onSelectionChange: function () {
            this._updateSelectionState();
        },

        onAdminConfigPress: function () {
            if (!this.byId("adminConfigDialog")) {
                this.loadFragment({
                    name: "ztm.tmapp.fragment.AdminConfigDialog"
                }).then(function (oDialog) {
                    this.getView().addDependent(oDialog);
                    oDialog.open();
                }.bind(this));
            } else {
                this.byId("adminConfigDialog").open();
            }
        },

        onCloseAdminConfig: function () {
            this.byId("adminConfigDialog").close();
        },

        onAdminConfigTableSelect: function (oEvent) {
            var oItem = oEvent.getSource(),
                sTableName = oItem.getDescription();

            this.byId("adminConfigDialog").close();
            this.getModel("view").setProperty("/selectedTable", sTableName);
            
            this._setBusy(true);
            this._loadSelectedTable()
                .catch(this._handleActionError.bind(this, "tableLoadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onCreate: function () {
            var aColumns = this._getColumns(),
                oValues = {};

            if (!this._ensureCanMaintain()) {
                return;
            }

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

        onDuplicate: function () {
            var aRows = this._getSelectedRows(),
                oValues = {};

            if (!this._ensureCanMaintain()) {
                return;
            }

            if (aRows.length !== 1) {
                this.showToast(this.getText("selectSingleRecord"));
                return;
            }

            var oRow = aRows[0];

            this._getColumns().forEach(function (column) {
                if (!this._isManagedColumn(column.name)) {
                    oValues[column.name] = oRow[column.name];
                }
            }.bind(this));

            this.getModel("view").setProperty("/createEdit", {
                mode: "create",
                title: this.getText("duplicateDialogTitleGeneric", [this._getSelectedTableName()]),
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

        onOpenPersonalization: function () {
            if (!this.byId("personalizationDialog")) {
                sap.ui.core.Fragment.load({
                    id: this.getView().getId(),
                    name: "ztm.tmapp.fragment.PersonalizationDialog",
                    controller: this
                }).then(function (oDialog) {
                    this.getView().addDependent(oDialog);
                    this._openPersonalizationDialog();
                }.bind(this));
            } else {
                this._openPersonalizationDialog();
            }
        },

        _openPersonalizationDialog: function () {
            var oList = this.byId("personalizationList");
            var aHiddenColumns = this.getModel("view").getProperty("/hiddenColumns") || [];
            
            oList.getItems().forEach(function (oItem) {
                var sColName = oItem.getBindingContext("view").getProperty("name");
                oItem.setSelected(aHiddenColumns.indexOf(sColName) === -1);
            });
            
            this.byId("personalizationDialog").open();
        },

        onPersonalizationApply: function () {
            var oList = this.byId("personalizationList");
            var aHiddenColumns = [];
            
            oList.getItems().forEach(function (oItem) {
                if (!oItem.getSelected()) {
                    aHiddenColumns.push(oItem.getBindingContext("view").getProperty("name"));
                }
            });
            
            this.getModel("view").setProperty("/hiddenColumns", aHiddenColumns);
            this.byId("personalizationDialog").close();
            this._rebuildTable();
        },

        onPersonalizationCancel: function () {
            this.byId("personalizationDialog").close();
        },

        onCreateTableOpen: function () {
            var sSelectedRole = this.getModel("view").getProperty("/selectedTemplateRole");
            this.getOwnerComponent()._sSelectedTemplateRole = sSelectedRole;
            this.getOwnerComponent().getRouter().navTo("CreateTable");
        },



        onDeleteTable: function () {
            var sTableName = this.getModel("view").getProperty("/selectedTable");
            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            if (!this._ensureCanMaintain()) return;
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
            if (!this._ensureCanMaintain()) return;
            if (!sTableName) return;
            
            this.getOwnerComponent().getRouter().navTo("AlterTable", {
                table: sTableName
            });
        },



        onEdit: function () {
            var aRows = this._getSelectedRows(),
                oRow;

            if (!this._ensureCanMaintain()) {
                return;
            }

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

            if (!this._ensureCanMaintain()) {
                return;
            }

            if (!this._validateCreateEdit(oPayload)) {
                return;
            }

            // For PATCH (edit mode), strip key columns and managed columns from the
            // data payload so that the backend only receives editable field values.
            var oDataValues;
            if (oPayload.mode === "create") {
                oDataValues = oPayload.values;
            } else {
                var aKeyColumns = oViewModel.getProperty("/keyColumns") || [];
                oDataValues = {};
                Object.keys(oPayload.values).forEach(function (sKey) {
                    if (aKeyColumns.indexOf(sKey) === -1 && !this._isManagedColumn(sKey)) {
                        oDataValues[sKey] = oPayload.values[sKey];
                    }
                }.bind(this));
            }

            oSchemaBrowserBody = oPayload.mode === "create"
                ? { data: oDataValues }
                : { keys: oPayload.originalKeys, data: oDataValues };

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

            if (!this._ensureCanMaintain()) {
                return;
            }

            if (!aRows.length) {
                this.showToast(this.getText("selectAtLeastOne"));
                return;
            }

            var sMessage;
            if (aRows.length === 1) {
                var sEntityKey = this._getTrackedEntityKeyValue(aRows[0]) || this._getEntityKeyString(aRows[0]);
                sMessage = this.getText("deleteConfirmSingle", [sEntityKey, sTableName]);
            } else {
                sMessage = this.getText("deleteConfirmGeneric", [aRows.length, sTableName]);
            }

            MessageBox.confirm(sMessage, {
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

            if (!this._ensureCanMaintain()) {
                return;
            }

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

            if (!this._ensureCanMaintain()) {
                return;
            }

            if (!this._hasValues(oValues)) {
                this.showToast(this.getText("enterBulkChange"));
                return;
            }

            var aColumns = this._getEditableColumns();
            var bValidationError = false;
            var oValueHelps = this.getModel("view").getProperty("/valueHelps");

            aColumns.forEach(function (column) {
                if (this._isValueHelpColumn(column)) {
                    var sEnteredValue = oValues[column.name];
                    if (sEnteredValue) {
                        var aValidValues = oValueHelps[column.name] || [];
                        var bIsValid = aValidValues.some(function (v) {
                            return String(v.key) === String(sEnteredValue);
                        });
                        if (!bIsValid) {
                            MessageBox.error("Invalid value '" + sEnteredValue + "' for column '" + column.name + "'. Please select a valid option from the dropdown list.");
                            bValidationError = true;
                        }
                    }
                }
            }.bind(this));

            if (bValidationError) {
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
            var sTable = this._getSelectedTableName(),
                sSchema = this.getModel("view").getProperty("/selectedSchema"),
                sUrl = "api/schema-browser/validation-rules?tableName=" + encodeURIComponent(sTable);

            if (!this._ensureCanMaintain()) {
                return;
            }

            if (sSchema) {
                sUrl += "&schemaName=" + encodeURIComponent(sSchema);
            }

            this.getModel("view").setProperty("/upload", {
                fileName: "",
                rows: [],
                previewText: "",
                totalCount: 0,
                validCount: 0,
                invalidCount: 0,
                instructions: this.getText("uploadInstructionsGeneric")
            });

            this._setBusy(true);
            this._prepareValueHelps()
                .then(function () {
                    return this._request(sUrl);
                }.bind(this))
                .then(function (oData) {
                    this.getModel("view").setProperty("/validationRules", oData.rules || []);
                    if (this.byId("massUploadFile")) {
                        this.byId("massUploadFile").clear();
                    }
                    this.byId("massUploadDialog").open();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "uploadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onMassUploadFileChange: function (oEvent) {
            var aFiles = oEvent.getParameter("files"),
                oFile = aFiles && aFiles[0];

            if (!oFile) {
                return;
            }

            this._setBusy(true);
            this._readCsvFile(oFile)
                .then(function (sContent) {
                    var aRawRows = this._parseCsv(sContent);
                    var aValidatedRows = this._validateUploadedRows(aRawRows);

                    var iTotal = aValidatedRows.length;
                    var iValid = aValidatedRows.filter(function (r) { return r._valid; }).length;
                    var iInvalid = iTotal - iValid;

                    this.getModel("view").setProperty("/upload", {
                        fileName: oFile.name,
                        rows: aValidatedRows,
                        totalCount: iTotal,
                        validCount: iValid,
                        invalidCount: iInvalid,
                        previewText: this.getText("uploadPreviewRowsGeneric", [iTotal]),
                        instructions: this.getText("uploadInstructionsGeneric")
                    });

                    this._rebuildUploadPreviewTable();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "uploadReadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _validateUploadedRows: function (aRows) {
            var aColumns = this._getColumns(),
                aRules = this.getModel("view").getProperty("/validationRules") || [],
                oValueHelps = this.getModel("view").getProperty("/valueHelps") || {},
                aRequiredKeys = this._getRequiredUploadKeyColumns(),
                sSelectedTableName = this._getSelectedTableName();

            return aRows.map(function (oRow) {
                var bValid = true,
                    aErrors = [];

                // 1. Mandatory Key & NotNull Check
                aRequiredKeys.forEach(function (sKey) {
                    if (oRow[sKey] === undefined || oRow[sKey] === null || oRow[sKey] === "") {
                        bValid = false;
                        aErrors.push(sKey + " is a required key.");
                    }
                });

                // 2. Data Type & Length Check
                aColumns.forEach(function (col) {
                    var sVal = oRow[col.name];
                    if (sVal !== undefined && sVal !== null && sVal !== "") {
                        if (col.length && String(sVal).length > col.length) {
                            bValid = false;
                            aErrors.push(col.name + " length exceeds limit (" + col.length + ").");
                        }

                        var sType = String(col.type).toUpperCase();
                        if (["INTEGER", "INT", "SMALLINT", "BIGINT"].indexOf(sType) > -1) {
                            if (isNaN(Number(sVal)) || !Number.isInteger(Number(sVal))) {
                                bValid = false;
                                aErrors.push(col.name + " must be an integer.");
                            }
                        } else if (["DECIMAL", "DOUBLE", "REAL", "FLOAT", "NUMBER"].indexOf(sType) > -1) {
                            if (isNaN(Number(sVal))) {
                                bValid = false;
                                aErrors.push(col.name + " must be a number.");
                            }
                        } else if (sType === "BOOLEAN") {
                            if (["true", "false", "1", "0"].indexOf(String(sVal).toLowerCase()) === -1) {
                                bValid = false;
                                aErrors.push(col.name + " must be boolean.");
                            }
                        }
                    } else if (col.isNotNull && !col.key && !this._isManagedColumn(col.name)) {
                        bValid = false;
                        aErrors.push(col.name + " cannot be null.");
                    }
                }.bind(this));

                // 3. Value Help Reference Check
                aColumns.forEach(function (col) {
                    if (this._isSelfReferentialValueHelpColumn(col, sSelectedTableName)) {
                        return;
                    }
                    if (this._isValueHelpColumn(col)) {
                        var sVal = oRow[col.name];
                        if (sVal !== undefined && sVal !== null && sVal !== "") {
                            var aOptions = oValueHelps[col.name] || [];
                            var bMatch = aOptions.some(function (opt) {
                                return String(opt.key) === String(sVal);
                            });
                            if (!bMatch) {
                                bValid = false;
                                aErrors.push(col.name + " contains invalid reference key.");
                            }
                        }
                    }
                }.bind(this));

                // 4. Custom Rules Check
                aRules.forEach(function (rule) {
                    var sCol = rule.columnName,
                        sVal = oRow[sCol];

                    if (sVal === undefined || sVal === null || sVal === "") {
                        if (rule.ruleType === "MANDATORY") {
                            bValid = false;
                            aErrors.push(rule.errorMessage || sCol + " is mandatory.");
                        }
                    } else {
                        var sValStr = String(sVal);
                        if (rule.ruleType === "REGEX") {
                            try {
                                var regex = new RegExp(rule.ruleValue);
                                if (!regex.test(sValStr)) {
                                    bValid = false;
                                    aErrors.push(rule.errorMessage || sCol + " fails pattern check.");
                                }
                            } catch(e) {}
                        } else if (rule.ruleType === "RANGE") {
                            var aParts = String(rule.ruleValue).split(","),
                                num = Number(sVal);
                            if (isNaN(num)) {
                                bValid = false;
                                aErrors.push(sCol + " must be numeric.");
                            } else {
                                var min = aParts[0] !== "" ? Number(aParts[0]) : -Infinity,
                                    max = aParts[1] !== "" ? Number(aParts[1]) : Infinity;
                                if (num < min || num > max) {
                                    bValid = false;
                                    aErrors.push(rule.errorMessage || sCol + " must be in range [" + rule.ruleValue + "].");
                                }
                            }
                        } else if (rule.ruleType === "VALUE_LIST") {
                            var aAllowed = String(rule.ruleValue).split(",").map(function (v) { return v.trim().toLowerCase(); });
                            if (aAllowed.indexOf(sValStr.toLowerCase()) === -1) {
                                bValid = false;
                                aErrors.push(rule.errorMessage || sCol + " must be one of: " + rule.ruleValue);
                            }
                        }
                    }
                });

                oRow._valid = bValid;
                oRow._message = bValid ? "Valid" : aErrors.join(" | ");
                return oRow;
            }.bind(this));
        },

        _rebuildUploadPreviewTable: function () {
            var oTable = this.byId("massUploadPreviewTable");
            if (!oTable) return;

            oTable.destroyColumns();
            oTable.unbindItems();

            oTable.addColumn(new sap.m.Column({
                width: "4rem",
                header: new sap.m.Label({ text: "Status" })
            }));
            oTable.addColumn(new sap.m.Column({
                width: "15rem",
                header: new sap.m.Label({ text: "Message" })
            }));

            var aColumns = this._getColumns();
            aColumns.forEach(function (col) {
                oTable.addColumn(new sap.m.Column({
                    width: "10rem",
                    header: new sap.m.Label({ text: col.name })
                }));
            });

            var aCells = [
                new sap.m.ObjectStatus({
                    icon: "{= ${view>_valid} ? 'sap-icon://sys-enter-2' : 'sap-icon://error' }",
                    state: "{= ${view>_valid} ? 'Success' : 'Error' }"
                }),
                new sap.m.Text({ text: "{view>_message}" })
            ];
            aColumns.forEach(function (col) {
                aCells.push(new sap.m.Text({ text: "{view>" + col.name + "}" }));
            });

            var oTemplate = new sap.m.ColumnListItem({
                vAlign: "Middle",
                cells: aCells
            });

            oTable.bindItems({
                path: "view>/upload/rows",
                template: oTemplate
            });
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
                sTableName = this._getSelectedTableName(),
                aValidRows = aRows.filter(function (row) { return row._valid; });

            if (!this._ensureCanMaintain()) {
                return;
            }

            if (!aValidRows.length) {
                this.showToast(this.getText("uploadNoRows"));
                return;
            }

            var aUploadPayload = aValidRows.map(function (row) {
                var clean = Object.assign({}, row);
                delete clean._valid;
                delete clean._message;
                return clean;
            });

            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/mass-upload";
            if (sSelectedSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSelectedSchema);
            }

            this._setBusy(true);
            this._request(sUrl, {
                method: "POST",
                body: JSON.stringify({ rows: aUploadPayload })
            })
                .then(function () {
                    this.byId("massUploadDialog").close();
                    this.showToast(this.getText("uploadSuccessGeneric", [aUploadPayload.length, sTableName]));
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
            return this._request("api/schema-browser/user-info")
                .then(function (oUserInfo) {
                    this._applyUserPermissions(oUserInfo);
                }.bind(this))
                .catch(function (oError) {
                    console.warn("Failed to load user info:", oError);
                    this._applyUserPermissions({});
                }.bind(this))
                .then(function () {
                    return this._request("api/schema-browser/schemas");
                }.bind(this))
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
                // When a role is selected, filter out ZSCHEMA_ system tables.
                // When no role is selected, show ALL tables.
                aFilteredTables = sSelectedTemplateRole
                    ? aTables.filter(function (oTable) {
                        return !String(oTable.name || "").toUpperCase().startsWith("ZSCHEMA_");
                    })
                    : aTables,
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
                }) || String(sSelectedTable || "").toUpperCase().startsWith("ZSCHEMA_");

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
            oViewModel.setProperty("/rowCount", typeof oResult.count === "number" ? oResult.count : (oResult.rows || []).length);
            oViewModel.setProperty("/rowCountText", this.getText("workspaceRowsCount", [oViewModel.getProperty("/rowCount")]));
            oViewModel.setProperty(
                "/tableTitle",
                this.getText("tableTitleGeneric", [
                    this._getSelectedTableName() || this.getText("tableTitle"),
                    typeof oResult.count === "number" ? oResult.count : (oResult.rows || []).length
                ])
            );
            oViewModel.setProperty(
                "/tableSubtitle",
                this._getSelectedTableName()
                    ? this.getText("workspaceTableSubtitle", [oViewModel.getProperty("/schemaName") || "", this._getSelectedTableName()])
                    : this.getText("workspaceSelectTableHint")
            );

            this._rebuildTable();
            this._applyFilters();
        },

        _rebuildTable: function () {
            var oTable = this.byId("plantTable"),
                aColumns = this._getColumns(),
                aHiddenColumns = this.getModel("view").getProperty("/hiddenColumns") || [],
                oTemplate;

            oTable.removeSelections(true);
            oTable.destroyColumns();
            oTable.unbindItems();
            
            var aVisibleColumns = aColumns.filter(function (col) {
                return aHiddenColumns.indexOf(col.name) === -1;
            });
            this.getModel("view").setProperty("/visibleColumnCount", aVisibleColumns.length);
            this.getModel("view").setProperty("/columnCountText", this.getText("workspaceColumnsCount", [aVisibleColumns.length]));

            aVisibleColumns.forEach(function (column) {
                oTable.addColumn(new Column({
                    header: new Text({
                        text: column.name
                    })
                }));
            });

            oTemplate = new ColumnListItem({
                type: "Inactive",
                cells: aVisibleColumns.map(function (column) {
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
            oViewModel.setProperty("/rowCountText", this.getText("workspaceRowsCount", [aFilteredRows.length]));
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
                    labelSpanXL: 12,
                    labelSpanL: 12,
                    labelSpanM: 12,
                    labelSpanS: 12,
                    emptySpanXL: 0,
                    emptySpanL: 0,
                    emptySpanM: 0,
                    emptySpanS: 0,
                    columnsXL: 3,
                    columnsL: 2,
                    columnsM: 2
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
            }.bind(this));
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

        _isSelfReferentialValueHelpColumn: function (oColumn, sTableName) {
            return this._isValueHelpColumn(oColumn)
                && this._getSemanticKey(oColumn.referenceTable) === this._getSemanticKey(sTableName)
                && this._getSemanticKey(oColumn.referenceColumn) === this._getSemanticKey(oColumn.name);
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
                    "/odata/v4/ds-table-maintenance/" + oConfig.entityName + this._buildODataKeyPredicate(oConfig, oRow),
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
            var sBaseUrl = "/odata/v4/ds-table-maintenance/" + oConfig.entityName;

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
                this._csrfTokenPromise = fetch("/odata/v4/ds-table-maintenance/", {
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
                if (this.byId("changeHistoryTabBar")) {
                    this.byId("changeHistoryTabBar").setSelectedKey(this.byId("changeHistoryTabBar").getItems()[0].getId());
                }
                return Promise.resolve().then(function () {
                    oView.byId("changeHistoryDialog").open();
                });
            }

            return this.loadFragment({
                name: "ztm.tmapp.fragment.ChangeHistoryDialog"
            }).then(function (oDialog) {
                oView.addDependent(oDialog);
                if (this.byId("changeHistoryTabBar")) {
                    this.byId("changeHistoryTabBar").setSelectedKey(this.byId("changeHistoryTabBar").getItems()[0].getId());
                }
                oDialog.open();
            }.bind(this));
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

                    // Visual Analytics Aggregation
                    var oUserMap = {}, oFieldMap = {}, oDateMap = {};
                    aHistory.forEach(function (oItem) {
                        var sUser = oItem.createdBy || "Unknown";
                        var sFormattedUser = this._formatUserLabel(sUser);
                        oUserMap[sFormattedUser] = (oUserMap[sFormattedUser] || 0) + 1;

                        var sField = oItem.attribute || "Unknown";
                        oFieldMap[sField] = (oFieldMap[sField] || 0) + 1;

                        var sDate = "Unknown";
                        if (oItem.createdAt) {
                            try {
                                sDate = String(oItem.createdAt).split("T")[0];
                            } catch(e) {}
                        }
                        oDateMap[sDate] = (oDateMap[sDate] || 0) + 1;
                    }, this);

                    var aUserSegments = Object.keys(oUserMap).map(function (sKey) {
                        return { label: sKey, value: oUserMap[sKey] };
                    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 6);

                    var aFieldBars = Object.keys(oFieldMap).map(function (sKey) {
                        return { label: sKey, value: oFieldMap[sKey] };
                    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 6);

                    var aTrendPoints = Object.keys(oDateMap).map(function (sKey) {
                        return { label: sKey, value: oDateMap[sKey] };
                    }).sort(function (a, b) {
                        return a.label.localeCompare(b.label);
                    }).slice(-6);

                    this.getModel("view").setProperty("/historyAnalytics", {
                        users: aUserSegments,
                        fields: aFieldBars,
                        trend: aTrendPoints
                    });
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

        _applyUserPermissions: function (oUserInfo) {
            var oViewModel = this.getModel("view"),
                bCanMaintain = oUserInfo.isAdmin === true
                    || oUserInfo.isDataEngineer === true
                    || oUserInfo.isDataSteward === true,
                bIsDisplayOnly = oUserInfo.isDisplay === true && !bCanMaintain,
                sRoleLabel = this.getText("workspaceRoleUnknown");

            if (oUserInfo.isAdmin === true) {
                sRoleLabel = this.getText("workspaceRoleAdmin");
            } else if (oUserInfo.isDataEngineer === true) {
                sRoleLabel = this.getText("workspaceRoleEngineer");
            } else if (oUserInfo.isDataSteward === true) {
                sRoleLabel = this.getText("workspaceRoleSteward");
            } else if (oUserInfo.isDisplay === true) {
                sRoleLabel = this.getText("workspaceRoleDisplay");
            }

            oViewModel.setProperty("/username", oUserInfo.username || "anonymous");
            oViewModel.setProperty("/isAdmin", oUserInfo.isAdmin === true);
            oViewModel.setProperty("/canMaintain", bCanMaintain);
            oViewModel.setProperty("/isReadOnlyRole", bIsDisplayOnly);
            oViewModel.setProperty("/accessRoleLabel", sRoleLabel);
            oViewModel.setProperty("/accessModeLabel", this.getText(bIsDisplayOnly ? "workspaceModeDisplay" : "workspaceModeEdit"));
            oViewModel.setProperty("/accessModeState", bIsDisplayOnly ? "Information" : "Success");
            oViewModel.setProperty("/heroSubtitle", this.getText(bIsDisplayOnly ? "workspaceHeroSubtitleDisplay" : "workspaceHeroSubtitle"));
            this._syncShellRoleState();
        },

        _bindShellRoleState: function () {
            var oShellModel = this.getOwnerComponent().getModel("shell");

            if (!oShellModel || this._oShellRoleBinding) {
                return;
            }

            this._oShellRoleBinding = oShellModel.bindProperty("/activeRoleProfile");
            this._oShellRoleBinding.attachChange(this._syncShellRoleState.bind(this));
            this._syncShellRoleState();
        },

        _syncShellRoleState: function () {
            var oShellModel = this.getOwnerComponent().getModel("shell"),
                oViewModel = this.getModel("view"),
                sRole = oShellModel && oShellModel.getProperty("/activeRoleProfile");

            if (!oShellModel || !sRole) {
                return;
            }

            var bCanMaintain = sRole === "ZTM_Admin"
                || sRole === "ZTM_DataEngineer"
                || sRole === "ZTM_DataSteward";
            var bIsDisplayOnly = sRole === "ZTM_Display";
            var sRoleLabel = this.getText("workspaceRoleUnknown");

            if (sRole === "ZTM_Admin") {
                sRoleLabel = this.getText("workspaceRoleAdmin");
            } else if (sRole === "ZTM_DataEngineer") {
                sRoleLabel = this.getText("workspaceRoleEngineer");
            } else if (sRole === "ZTM_DataSteward") {
                sRoleLabel = this.getText("workspaceRoleSteward");
            } else if (sRole === "ZTM_Display") {
                sRoleLabel = this.getText("workspaceRoleDisplay");
            }

            oViewModel.setProperty("/canMaintain", bCanMaintain);
            oViewModel.setProperty("/isReadOnlyRole", bIsDisplayOnly);
            oViewModel.setProperty("/accessRoleLabel", sRoleLabel);
            oViewModel.setProperty("/accessModeLabel", this.getText(bIsDisplayOnly ? "workspaceModeDisplay" : "workspaceModeEdit"));
            oViewModel.setProperty("/accessModeState", bIsDisplayOnly ? "Information" : "Success");
        },

        _ensureCanMaintain: function () {
            if (this.getModel("view").getProperty("/canMaintain")) {
                return true;
            }

            this.showToast(this.getText("displayModeBlocked"));
            return false;
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

        _formatUserLabel: function (sUser) {
            if (!sUser) {
                return "Unknown";
            }
            if (sUser.indexOf("@") > -1) {
                var sPrefix = sUser.split("@")[0];
                var sClean = sPrefix.replace(/[\._\-]/g, " ");
                var aWords = sClean.split(/\s+/);
                var aFormatted = aWords.map(function(sWord) {
                    if (!sWord) {
                        return "";
                    }
                    return sWord.charAt(0).toUpperCase() + sWord.slice(1);
                });
                return aFormatted.filter(Boolean).join(" ");
            }
            return sUser;
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
