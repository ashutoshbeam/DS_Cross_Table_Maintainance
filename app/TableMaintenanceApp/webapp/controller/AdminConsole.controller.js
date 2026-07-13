sap.ui.define([
    "ztm/tmapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Input",
    "sap/m/Select",
    "sap/ui/layout/form/SimpleForm",
    "sap/ui/core/Item"
], function (BaseController, JSONModel, Filter, FilterOperator, MessageToast, MessageBox, Dialog, Button, Label, Input, Select, SimpleForm, Item) {
    "use strict";

    return BaseController.extend("ztm.tmapp.controller.AdminConsole", {
        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                logsBusy: false,
                configBusy: false,
                selectedConnection: "DEV_SPACE",
                selectedSchema: "",
                schemaSelectItems: [],
                businessMappings: {
                    dataStewardSchema: "DATA_STEWARD_GOLD",
                    dataEngineerSchema: "DATASPHERE_CORE"
                },
                roleTemplates: [
                    { roleName: "Global Administrator", canCreate: true, canAlter: true, canDrop: true, canRead: true, canWrite: true, canDelete: true },
                    { roleName: "Data Engineer / Architect", canCreate: true, canAlter: true, canDrop: true, canRead: true, canWrite: true, canDelete: false },
                    { roleName: "Data Steward / Business User", canCreate: false, canAlter: false, canDrop: false, canRead: true, canWrite: true, canDelete: true },
                    { roleName: "Display User", canCreate: false, canAlter: false, canDrop: false, canRead: true, canWrite: false, canDelete: false }
                ],
                globalValidations: [
                    { semanticType: "PLANT", ruleType: "REGEX", ruleValue: "^[0-9]{4}$", errorMessage: "Plant ID must be exactly 4 digits." },
                    { semanticType: "COMPANY_CODE", ruleType: "REGEX", ruleValue: "^[A-Za-z0-9]{4}$", errorMessage: "Company code must be 4 characters." },
                    { semanticType: "SALES_ORG", ruleType: "REGEX", ruleValue: "^[A-Za-z0-9]{4}$", errorMessage: "Sales Org must be 4 characters." },
                    { semanticType: "STATUS", ruleType: "VALUE_LIST", ruleValue: "Active,Pending,Closed", errorMessage: "Status must be Active, Pending or Closed." }
                ],
                auditLogs: [],
                filteredAuditLogs: [],
                searchLogs: "",
                logSchemaItems: [],
                selectedLogSchema: "",
                selectedLogTable: "",
                selectedLogUser: "",
                logTableItems: [],
                logUserItems: [],
                roleTemplateOptions: [],
                btpUsers: [],
                btpUsersConfigured: false,
                selectedAdminTab: "roles",

                selectedConfigTable: "",
                selectedConfigCount: 0,
                configColumns: [],
                configKeyColumns: [],
                configRows: []
            });

            this.getView().setModel(oViewModel, "view");

            this.getRouter().getRoute("AdminConsole").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments") || {};
            var oQuery = oArgs["?query"] || {};
            var sSection = oQuery.section || "roles";
            var oViewModel = this.getModel("view");

            oViewModel.setProperty("/selectedAdminTab", sSection);

            this._loadSchemas();
            this._loadRoleTemplateOptions();
            this._loadAuditLogs();
            this._loadBtpUsers();
        },

        _loadRoleTemplateOptions: function () {
            var oViewModel = this.getModel("view");
            var sSchema = oViewModel.getProperty("/selectedSchema");
            var sUrl = "api/schema-browser/template-roles";

            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            return this._request(sUrl)
                .then(function (oResult) {
                    oViewModel.setProperty("/roleTemplateOptions", oResult.templateRoles || []);
                })
                .catch(function (oError) {
                    oViewModel.setProperty("/roleTemplateOptions", []);
                    console.warn("Failed to load template roles:", oError);
                });
        },

        onAdminTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key") || "roles";
            this.getModel("view").setProperty("/selectedAdminTab", sKey);

            var oShellModel = this.getOwnerComponent().getModel("shell");
            if (oShellModel) {
                oShellModel.setProperty("/selectedAdminSection", sKey);
                oShellModel.setProperty("/selectedModule", "AdminConsole_" + sKey);
            }

            this.getRouter().navTo("AdminConsole", {
                query: {
                    section: sKey
                }
            }, true);
        },



        _loadSchemas: function () {
            this._setBusy(true);
            var oViewModel = this.getModel("view");

            this._request("api/schema-browser/schemas")
                .then(function (oResult) {
                    var aSchemas = oResult.schemas || [];
                    oViewModel.setProperty("/schemaSelectItems", aSchemas);
                    var sCurrentSchema = oResult.currentSchema || "";
                    oViewModel.setProperty("/selectedSchema", sCurrentSchema);

                    // Build log schema items
                    var aSchemaItems = [{ key: "", text: "-- All Schemas --" }].concat(
                        aSchemas.map(function (s) {
                            return { key: s.name, text: s.name };
                        })
                    );
                    oViewModel.setProperty("/logSchemaItems", aSchemaItems);

                    this._loadRoleTemplateOptions();
                    this._loadTables();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "schemasLoadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _loadTables: function () {
            var oViewModel = this.getModel("view");
            var sSchema = oViewModel.getProperty("/selectedSchema");
            var sUrl = "api/schema-browser/tables";
            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }
            this._request(sUrl)
                .then(function (oResult) {
                    oViewModel.setProperty("/allTables", oResult.tables || []);
                })
                .catch(function () {
                    oViewModel.setProperty("/allTables", []);
                });
        },

        _loadBtpUsers: function (sSearch) {
            var oViewModel = this.getModel("view");
            var sUrl = "api/admin/btp-users";
            if (sSearch) {
                sUrl += "?search=" + encodeURIComponent(sSearch);
            }

            return this._request(sUrl)
                .then(function (oResult) {
                    oViewModel.setProperty("/btpUsers", oResult.users || []);
                    oViewModel.setProperty("/btpUsersConfigured", oResult.configured === true);
                })
                .catch(function (oError) {
                    oViewModel.setProperty("/btpUsers", []);
                    oViewModel.setProperty("/btpUsersConfigured", false);
                    console.warn("Failed to load BTP users:", oError);
                });
        },

        onSchemaChange: function () {
            MessageToast.show("Technical schema context changed.");
            this._loadTables();
            this._loadRoleTemplateOptions();
            this._loadConfigTableData();
        },

        _loadAuditLogs: function () {
            var oViewModel = this.getModel("view");
            oViewModel.setProperty("/logsBusy", true);

            var oModel = this.getOwnerComponent().getModel();
            if (!oModel) {
                oViewModel.setProperty("/logsBusy", false);
                return;
            }

            var oBinding = oModel.bindList("/ChangeView", undefined, undefined, []);
            oBinding.requestContexts(0, 150)
                .then(function (aContexts) {
                    var aLogs = (aContexts || []).map(function (oContext) {
                        return this._normalizeAuditLog(oContext.getObject());
                    }.bind(this));

                    // Sort logs descending by timestamp
                    aLogs.sort(function (a, b) {
                        return new Date(b.createdAtRaw || 0) - new Date(a.createdAtRaw || 0);
                    });

                    // Dynamically build unique user filters
                    var oUniqueUsers = {};
                    aLogs.forEach(function(log) {
                        if (log.userEmail) {
                            oUniqueUsers[log.userEmail] = log.userEmail;
                        }
                    });

                    var aUserItems = [{ key: "", text: "-- All Users --" }].concat(
                        Object.keys(oUniqueUsers).map(function (k) {
                            return { key: k, text: k };
                        })
                    );

                    oViewModel.setProperty("/logUserItems", aUserItems);
                    oViewModel.setProperty("/auditLogs", aLogs);

                    // Rebuild and filter table dropdown after loading schema tables
                    this._loadLogTables().finally(function () {
                        this._updateLogTableDropdown();
                        this._applyLogsFilter();
                    }.bind(this));
                }.bind(this))
                .catch(function (oError) {
                    console.warn("Failed to load global audit logs:", oError);
                    oViewModel.setProperty("/auditLogs", []);
                    oViewModel.setProperty("/filteredAuditLogs", []);
                }.bind(this))
                .finally(function () {
                    oViewModel.setProperty("/logsBusy", false);
                });
        },

        onRefreshLogs: function () {
            this._loadAuditLogs();
        },

        onSearchLogs: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue") || "";
            this.getModel("view").setProperty("/searchLogs", sQuery);
            this._applyLogsFilter();
        },

        onLogFilterChange: function (oEvent) {
            var oSource = oEvent ? oEvent.getSource() : null;
            if (oSource && oSource.getId().indexOf("logSchemaFilterCombo") > -1) {
                this._loadLogTables().finally(function () {
                    this._updateLogTableDropdown();
                    this._applyLogsFilter();
                }.bind(this));
            } else {
                this._applyLogsFilter();
            }
        },

        onClearLogFilters: function () {
            var oViewModel = this.getModel("view");
            oViewModel.setProperty("/selectedLogSchema", "");
            oViewModel.setProperty("/selectedLogTable", "");
            oViewModel.setProperty("/selectedLogUser", "");
            oViewModel.setProperty("/searchLogs", "");
            this._updateLogTableDropdown();
            this._applyLogsFilter();
        },

        _loadLogTables: function () {
            var oViewModel = this.getModel("view");
            var sSchema = oViewModel.getProperty("/selectedLogSchema");
            if (!sSchema) {
                oViewModel.setProperty("/logTables", []);
                return Promise.resolve();
            }
            var sUrl = "api/schema-browser/tables?schemaName=" + encodeURIComponent(sSchema);
            return this._request(sUrl)
                .then(function (oResult) {
                    oViewModel.setProperty("/logTables", oResult.tables || []);
                })
                .catch(function () {
                    oViewModel.setProperty("/logTables", []);
                });
        },

        _updateLogTableDropdown: function () {
            var oViewModel = this.getModel("view");
            var aLogs = oViewModel.getProperty("/auditLogs") || [];
            var sSchema = oViewModel.getProperty("/selectedLogSchema");
            var aLogTables = oViewModel.getProperty("/logTables") || [];

            var oUniqueTables = {};

            // 1. Add all schema tables
            aLogTables.forEach(function (table) {
                if (table.name) {
                    oUniqueTables[table.name] = table.name;
                }
            });

            // 2. Add log-specific paths
            aLogs.forEach(function (log) {
                if (log.logTablePath && (!sSchema || log.logSchema === sSchema)) {
                    oUniqueTables[log.logTablePath] = log.logTablePath;
                }
            });

            var aTableItems = [{ key: "", text: "-- All Tables --" }].concat(
                Object.keys(oUniqueTables).map(function (k) {
                    return { key: k, text: oUniqueTables[k] };
                })
            );

            oViewModel.setProperty("/logTableItems", aTableItems);

            // If current selected table is no longer in the list, clear it
            var sTable = oViewModel.getProperty("/selectedLogTable");
            if (sTable && !oUniqueTables[sTable]) {
                oViewModel.setProperty("/selectedLogTable", "");
            }
        },

        _applyLogsFilter: function () {
            var oViewModel = this.getModel("view");
            var aLogs = oViewModel.getProperty("/auditLogs") || [];
            var sQuery = (oViewModel.getProperty("/searchLogs") || "").toLowerCase();
            var sSchema = oViewModel.getProperty("/selectedLogSchema");
            var sTable = oViewModel.getProperty("/selectedLogTable");
            var sUser = oViewModel.getProperty("/selectedLogUser");

            var aFiltered = aLogs.filter(function (oLog) {
                var bSearchMatch = !sQuery || 
                    String(oLog.userEmail || "").toLowerCase().indexOf(sQuery) > -1 ||
                    String(oLog.modification || "").toLowerCase().indexOf(sQuery) > -1 ||
                    String(oLog.logEntityPath || "").toLowerCase().indexOf(sQuery) > -1 ||
                    String(oLog.logSchema || "").toLowerCase().indexOf(sQuery) > -1 ||
                    String(oLog.logTable || "").toLowerCase().indexOf(sQuery) > -1 ||
                    String(oLog.attribute || "").toLowerCase().indexOf(sQuery) > -1 ||
                    String(oLog.valueChangedFrom || "").toLowerCase().indexOf(sQuery) > -1 ||
                    String(oLog.valueChangedTo || "").toLowerCase().indexOf(sQuery) > -1;

                var bSchemaMatch = !sSchema || oLog.logSchema === sSchema;
                var bTableMatch = !sTable || oLog.logTablePath === sTable;
                var bUserMatch = !sUser || oLog.userEmail === sUser;

                return bSearchMatch && bSchemaMatch && bTableMatch && bUserMatch;
            });
            oViewModel.setProperty("/filteredAuditLogs", aFiltered);
        },

        _normalizeAuditLog: function (oData) {
            var oLog = Object.assign({}, oData || {});
            var oParsed = this._parseLogContext(oLog.serviceEntityPath || oLog.serviceEntity || "");
            var sCreatedAt = oLog.createdAt ? String(oLog.createdAt) : "";

            oLog.createdAtRaw = sCreatedAt;
            oLog.createdAtDisplay = sCreatedAt
                ? sCreatedAt.replace("T", " ").replace("Z", "").split(".")[0]
                : "";
            oLog.modification = String(oLog.modification || "").toUpperCase();
            oLog.userEmail = oLog.createdBy || "";
            oLog.logSchema = oParsed.schema;
            oLog.logTable = oParsed.table;
            oLog.logTablePath = oParsed.tablePath;
            oLog.logEntityPath = oParsed.displayPath || oLog.serviceEntityPath || oLog.serviceEntity || "";

            return oLog;
        },

        _parseLogContext: function (sEntityPath) {
            var sValue = String(sEntityPath || "");
            var sPathOnly = sValue.split("(")[0];
            var aParts = sPathOnly.split(".").filter(Boolean);
            var sSchema = "";
            var sTable = "";
            var sTablePath = "";

            if (aParts.length >= 2) {
                sSchema = aParts[aParts.length - 2];
                sTable = aParts[aParts.length - 1];
                sTablePath = sSchema + "." + sTable;
            } else if (aParts.length === 1) {
                sTable = aParts[0];
                sTablePath = sTable;
            }

            return {
                schema: sSchema,
                table: sTable,
                tablePath: sTablePath,
                displayPath: sPathOnly
            };
        },

        onAddValidationRule: function () {
            var oViewModel = this.getModel("view");
            var aValidations = oViewModel.getProperty("/globalValidations") || [];
            aValidations.push({
                semanticType: "",
                ruleType: "MANDATORY",
                ruleValue: "",
                errorMessage: ""
            });
            oViewModel.setProperty("/globalValidations", aValidations);
        },

        onDeleteValidationRule: function (oEvent) {
            var oButton = oEvent.getSource();
            var oItem = oButton.getParent();
            var sPath = oItem.getBindingContext("view").getPath();
            var iIndex = parseInt(sPath.split("/").pop(), 10);
            
            var oViewModel = this.getModel("view");
            var aValidations = oViewModel.getProperty("/globalValidations") || [];
            aValidations.splice(iIndex, 1);
            oViewModel.setProperty("/globalValidations", aValidations);
        },

        onSaveValidations: function () {
            MessageToast.show("Global validation rules saved successfully.");
        },

        onSaveRoleTemplates: function () {
            MessageToast.show("Role template matrix updated successfully.");
        },

        /* --- Configuration Tables Maintenance (Task 3) --- */

        onConfigTableChange: function () {
            this._loadConfigTableData();
        },

        onRefreshConfigData: function () {
            this._loadConfigTableData();
        },

        _loadConfigTableData: function () {
            var oViewModel = this.getModel("view");
            var sTable = oViewModel.getProperty("/selectedConfigTable");
            var sSchema = oViewModel.getProperty("/selectedSchema");

            if (!sTable) {
                oViewModel.setProperty("/configColumns", []);
                oViewModel.setProperty("/configRows", []);
                oViewModel.setProperty("/selectedConfigCount", 0);
                this._rebuildConfigTable([], []);
                return;
            }

            oViewModel.setProperty("/configBusy", true);

            var sMetadataUrl = "api/schema-browser/tables/" + encodeURIComponent(sTable) + "/metadata";
            var sRowsUrl = "api/schema-browser/tables/" + encodeURIComponent(sTable) + "/rows";
            if (sSchema) {
                sMetadataUrl += "?schemaName=" + encodeURIComponent(sSchema);
                sRowsUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            Promise.all([
                this._request(sMetadataUrl),
                this._request(sRowsUrl)
            ])
                .then(function (aResults) {
                    var oMetadata = aResults[0];
                    var oData = aResults[1];

                    var aColumns = oMetadata.columns || [];
                    var aKeyColumns = oMetadata.keyColumns || [];
                    var aRows = oData.rows || [];

                    oViewModel.setProperty("/configColumns", aColumns);
                    oViewModel.setProperty("/configKeyColumns", aKeyColumns);
                    oViewModel.setProperty("/configRows", aRows);
                    oViewModel.setProperty("/selectedConfigCount", 0);

                    this._rebuildConfigTable(aColumns, aRows);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "tableLoadFailed"))
                .finally(function () {
                    oViewModel.setProperty("/configBusy", false);
                }.bind(this));
        },

        _rebuildConfigTable: function (aColumns, aRows) {
            var oTable = this.byId("configDataTable");
            if (!oTable) return;

            oTable.removeSelections(true);
            oTable.destroyColumns();
            oTable.unbindItems();

            if (!aColumns || !aColumns.length) {
                return;
            }

            // Bind Columns
            aColumns.forEach(function (col) {
                oTable.addColumn(new sap.m.Column({
                    header: new Label({ text: col.name, design: "Bold" })
                }));
            });

            // Bind Cells Template
            var aCells = aColumns.map(function (col) {
                return new sap.m.Text({
                    text: {
                        path: "view>" + col.name,
                        formatter: function (v) {
                            if (v === null || v === undefined) return "";
                            return String(v);
                        }
                    }
                });
            });

            var oTemplate = new sap.m.ColumnListItem({
                vAlign: "Middle",
                cells: aCells
            });

            oTable.bindItems({
                path: "view>/configRows",
                template: oTemplate
            });

            // Apply current filter table if any is selected (e.g. on refresh)
            var sFilterTable = this.getModel("view").getProperty("/selectedFilterTable");
            if (sFilterTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) {
                    oBinding.filter([new Filter("TABLE_NAME", FilterOperator.EQ, sFilterTable)]);
                }
            }
        },

        onConfigSelectionChange: function () {
            var oTable = this.byId("configDataTable");
            var iSelected = oTable.getSelectedContexts().length;
            this.getModel("view").setProperty("/selectedConfigCount", iSelected);
        },

        onConfigTableFilterChange: function () {
            var oTable = this.byId("configDataTable");
            var oBinding = oTable.getBinding("items");
            if (!oBinding) return;

            var sFilterTable = this.getModel("view").getProperty("/selectedFilterTable");
            var aFilters = [];
            if (sFilterTable) {
                aFilters.push(new Filter("TABLE_NAME", FilterOperator.EQ, sFilterTable));
            }
            oBinding.filter(aFilters);
            this.onConfigSelectionChange(); // Reset selection count
        },

        _loadColumnsForTable: function (sTable, oComboBox) {
            if (!sTable) {
                var oModel = new JSONModel([]);
                oComboBox.setModel(oModel, "cols");
                oComboBox.bindItems({
                    path: "cols>/",
                    template: new Item({ key: "{cols>name}", text: "{cols>name}" })
                });
                return;
            }
            var sSchema = this.getModel("view").getProperty("/selectedSchema");
            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTable) + "/metadata";
            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }
            oComboBox.setBusy(true);
            this._request(sUrl)
                .then(function (oMetadata) {
                    var aCols = (oMetadata.columns || []).map(function (c) {
                        return { name: c.name };
                    });
                    var oModel = new JSONModel(aCols);
                    oComboBox.setModel(oModel, "cols");
                    oComboBox.bindItems({
                        path: "cols>/",
                        template: new Item({ key: "{cols>name}", text: "{cols>name}" })
                    });
                })
                .catch(function () {
                    var oModel = new JSONModel([]);
                    oComboBox.setModel(oModel, "cols");
                    oComboBox.bindItems({
                        path: "cols>/",
                        template: new Item({ key: "{cols>name}", text: "{cols>name}" })
                    });
                })
                .finally(function () {
                    oComboBox.setBusy(false);
                });
        },

        _createConfigControl: function (col, sDefaultValue, bEditable, oSimpleForm, oInputMap) {
            var oControl;
            var sColName = col.name;
            var sSelectedConfigTable = this.getModel("view").getProperty("/selectedConfigTable");
            var bIsRoleTemplateDefinition = sSelectedConfigTable === "ZSCHEMA_ROLE_TEMPLATE_DEFINITION";

            if (sColName === "TABLE_NAME" || sColName === "REFERENCE_TABLE") {
                oControl = new sap.m.ComboBox({
                    width: "100%",
                    value: sDefaultValue,
                    editable: bEditable,
                    placeholder: "Select Table",
                    items: {
                        path: "view>/allTables",
                        template: new Item({ key: "{view>name}", text: "{view>name}" })
                    }
                });
            } else if (sColName === "COLUMN_NAME" || sColName === "REFERENCE_COLUMN") {
                oControl = new sap.m.ComboBox({
                    width: "100%",
                    value: sDefaultValue,
                    editable: bEditable,
                    placeholder: "Select Column"
                });
            } else if (sColName === "RULE_TYPE") {
                oControl = new sap.m.ComboBox({
                    width: "100%",
                    value: sDefaultValue,
                    editable: bEditable,
                    placeholder: "Select Rule Type",
                    items: [
                        new Item({ key: "MANDATORY", text: "MANDATORY" }),
                        new Item({ key: "REGEX", text: "REGEX" }),
                        new Item({ key: "RANGE", text: "RANGE" }),
                        new Item({ key: "VALUE_LIST", text: "VALUE_LIST" })
                    ]
                });
            } else if (sColName === "SEMANTIC_TYPE") {
                oControl = new sap.m.ComboBox({
                    width: "100%",
                    value: sDefaultValue,
                    editable: bEditable,
                    placeholder: "Select or Enter Semantic Type",
                    items: [
                        new Item({ key: "Plant", text: "Plant" }),
                        new Item({ key: "Company Code", text: "Company Code" }),
                        new Item({ key: "Sales Org", text: "Sales Org" }),
                        new Item({ key: "Currency", text: "Currency" })
                    ]
                });
            } else if (sColName === "TEMPLATE_ROLE" && !bIsRoleTemplateDefinition) {
                oControl = new sap.m.ComboBox({
                    width: "100%",
                    value: sDefaultValue,
                    editable: bEditable,
                    placeholder: "Select Template Role",
                    items: {
                        path: "view>/roleTemplateOptions",
                        template: new Item({ key: "{view>key}", text: "{view>text}" })
                    }
                });
            } else if (sColName === "USER_EMAIL") {
                oControl = new sap.m.ComboBox({
                    width: "100%",
                    value: sDefaultValue,
                    editable: bEditable,
                    placeholder: "Select BTP User",
                    items: {
                        path: "view>/btpUsers",
                        template: new Item({ key: "{view>email}", text: "{view>text}" })
                    }
                });
            } else if (sColName === "VALUE_HELP_REQUIRED") {
                var sKeyVal = (sDefaultValue === "true" || sDefaultValue === true || sDefaultValue === "TRUE" || sDefaultValue === "") ? "true" : "false";
                oControl = new sap.m.Select({
                    width: "100%",
                    selectedKey: sKeyVal,
                    items: [
                        new Item({ key: "true", text: "True" }),
                        new Item({ key: "false", text: "False" })
                    ]
                });
            } else {
                oControl = new Input({
                    width: "100%",
                    value: String(sDefaultValue),
                    editable: bEditable,
                    placeholder: bEditable ? "Enter " + col.name : ""
                });
            }

            oSimpleForm.addContent(oControl);
            oInputMap[sColName] = oControl;
            return oControl;
        },

        _buildConfigForm: function (oSimpleForm, aColumns, aKeys, oSelectedData, oInputMap) {
            var oViewModel = this.getModel("view");
            var sCurrentSchema = oViewModel.getProperty("/selectedSchema") || "";

            aColumns.forEach(function (col) {
                var bIsKey = col.key || aKeys.includes(col.name);
                oSimpleForm.addContent(new Label({
                    text: col.name,
                    required: bIsKey
                }));

                var sDefaultValue = "";
                if (oSelectedData && oSelectedData[col.name] !== undefined && oSelectedData[col.name] !== null) {
                    sDefaultValue = oSelectedData[col.name];
                } else if (col.name === "SCHEMA_NAME") {
                    sDefaultValue = sCurrentSchema;
                }

                var bEditable = true;
                if (col.name === "SCHEMA_NAME" || col.name === "UPDATED_AT") {
                    bEditable = false;
                } else if (oSelectedData && bIsKey) {
                    bEditable = false;
                }

                this._createConfigControl(col, sDefaultValue, bEditable, oSimpleForm, oInputMap);
            }.bind(this));

            // Link Table and Column selectors
            var oTableControl = oInputMap["TABLE_NAME"];
            var oColumnControl = oInputMap["COLUMN_NAME"];
            if (oTableControl && oColumnControl) {
                oTableControl.attachChange(function (oEvent) {
                    var sSelTable = oEvent.getSource().getValue();
                    oColumnControl.setValue("");
                    this._loadColumnsForTable(sSelTable, oColumnControl);
                }.bind(this));

                var sTableVal = oTableControl.getValue ? oTableControl.getValue() : "";
                if (sTableVal) {
                    this._loadColumnsForTable(sTableVal, oColumnControl);
                }
            }

            var oRefTableControl = oInputMap["REFERENCE_TABLE"];
            var oRefColumnControl = oInputMap["REFERENCE_COLUMN"];
            if (oRefTableControl && oRefColumnControl) {
                oRefTableControl.attachChange(function (oEvent) {
                    var sSelTable = oEvent.getSource().getValue();
                    oRefColumnControl.setValue("");
                    this._loadColumnsForTable(sSelTable, oRefColumnControl);
                }.bind(this));

                var sRefTableVal = oRefTableControl.getValue ? oRefTableControl.getValue() : "";
                if (sRefTableVal) {
                    this._loadColumnsForTable(sRefTableVal, oRefColumnControl);
                }
            }
        },

        onAddConfigRow: function () {
            var oViewModel = this.getModel("view");
            var sTable = oViewModel.getProperty("/selectedConfigTable");
            var aColumns = oViewModel.getProperty("/configColumns") || [];
            var aKeys = oViewModel.getProperty("/configKeyColumns") || [];

            this._loadBtpUsers().finally(function () {
                var oSimpleForm = new SimpleForm({
                    editable: true,
                    layout: "ResponsiveGridLayout"
                });

                var oInputMap = {};
                this._buildConfigForm(oSimpleForm, aColumns, aKeys, null, oInputMap);

                var oDialog = new Dialog({
                    title: "Add Row to " + sTable,
                    contentWidth: "450px",
                    content: [oSimpleForm],
                    beginButton: new Button({
                        text: "Save",
                        type: "Emphasized",
                        press: function () {
                            var oData = {};
                            var bHasMissingKey = false;

                            aColumns.forEach(function (col) {
                                var oCtrl = oInputMap[col.name];
                                var sVal = "";
                                if (oCtrl.getSelectedKey) {
                                    sVal = oCtrl.getSelectedKey();
                                }
                                if (!sVal && oCtrl.getValue) {
                                    sVal = oCtrl.getValue();
                                }
                                oData[col.name] = sVal;

                                var bIsKey = col.key || aKeys.includes(col.name);
                                if (bIsKey && !sVal) {
                                    bHasMissingKey = true;
                                }
                            });

                            if (bHasMissingKey) {
                                MessageBox.error("Please fill in all primary key fields.");
                                return;
                            }

                            oDialog.close();
                            this._saveConfigRow(sTable, oData);
                        }.bind(this)
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: function () {
                            oDialog.close();
                        }
                    }),
                    afterClose: function () {
                        oDialog.destroy();
                    }
                });

                this.getView().addDependent(oDialog);
                oDialog.open();
            }.bind(this));
        },

        _saveConfigRow: function (sTable, oData) {
            this._setBusy(true);
            var sSchema = this.getModel("view").getProperty("/selectedSchema");
            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTable) + "/rows";
            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            this._request(sUrl, {
                method: "POST",
                body: JSON.stringify({ data: oData })
            })
                .then(function () {
                    MessageToast.show("Config row inserted successfully.");
                    return Promise.all([
                        this._loadConfigTableData(),
                        this._loadRoleTemplateOptions()
                    ]);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "createFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onEditConfigRow: function () {
            var oViewModel = this.getModel("view");
            var sTable = oViewModel.getProperty("/selectedConfigTable");
            var aColumns = oViewModel.getProperty("/configColumns") || [];
            var aKeys = oViewModel.getProperty("/configKeyColumns") || [];
            
            var oTable = this.byId("configDataTable");
            var aContexts = oTable.getSelectedContexts();
            if (aContexts.length !== 1) {
                return;
            }
            var oSelectedData = aContexts[0].getObject();

            this._loadBtpUsers().finally(function () {
                var oSimpleForm = new SimpleForm({
                    editable: true,
                    layout: "ResponsiveGridLayout"
                });

                var oInputMap = {};
                this._buildConfigForm(oSimpleForm, aColumns, aKeys, oSelectedData, oInputMap);

                var oDialog = new Dialog({
                    title: "Edit Row in " + sTable,
                    contentWidth: "450px",
                    content: [oSimpleForm],
                    beginButton: new Button({
                        text: "Save",
                        type: "Emphasized",
                        press: function () {
                            var oData = {};
                            var oKeysPayload = {};

                            aColumns.forEach(function (col) {
                                var oCtrl = oInputMap[col.name];
                                var sVal = "";
                                if (oCtrl.getSelectedKey) {
                                    sVal = oCtrl.getSelectedKey();
                                }
                                if (!sVal && oCtrl.getValue) {
                                    sVal = oCtrl.getValue();
                                }
                                oData[col.name] = sVal;

                                var bIsKey = col.key || aKeys.includes(col.name);
                                if (bIsKey) {
                                    oKeysPayload[col.name] = oSelectedData[col.name];
                                }
                            });

                            oDialog.close();
                            this._updateConfigRow(sTable, oKeysPayload, oData);
                        }.bind(this)
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: function () {
                            oDialog.close();
                        }
                    }),
                    afterClose: function () {
                        oDialog.destroy();
                    }
                });

                this.getView().addDependent(oDialog);
                oDialog.open();
            }.bind(this));
        },

        _updateConfigRow: function (sTable, oKeys, oData) {
            this._setBusy(true);
            var sSchema = this.getModel("view").getProperty("/selectedSchema");
            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTable) + "/rows";
            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            this._request(sUrl, {
                method: "PATCH",
                body: JSON.stringify({ keys: oKeys, data: oData })
            })
                .then(function () {
                    MessageToast.show("Config row updated successfully.");
                    return Promise.all([
                        this._loadConfigTableData(),
                        this._loadRoleTemplateOptions()
                    ]);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "updateFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onDeleteConfigRow: function () {
            var oTable = this.byId("configDataTable");
            var aContexts = oTable.getSelectedContexts();
            var sTable = this.getModel("view").getProperty("/selectedConfigTable");
            var sSchema = this.getModel("view").getProperty("/selectedSchema");
            var aKeys = this.getModel("view").getProperty("/configKeyColumns") || [];

            if (!aContexts.length) {
                return;
            }

            MessageBox.confirm("Are you sure you want to delete the selected configuration row(s)?", {
                actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.DELETE,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.DELETE) {
                        this._deleteConfigRows(sTable, sSchema, aContexts, aKeys);
                    }
                }.bind(this)
            });
        },

        _deleteConfigRows: function (sTable, sSchema, aContexts, aKeys) {
            this._setBusy(true);
            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTable) + "/rows";
            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            var aPromises = aContexts.map(function (oContext) {
                var oRow = oContext.getObject();
                var oKeyPayload = {};
                aKeys.forEach(function (k) {
                    oKeyPayload[k] = oRow[k];
                });
                return this._request(sUrl, {
                    method: "DELETE",
                    body: JSON.stringify({ keys: oKeyPayload })
                });
            }.bind(this));

            Promise.all(aPromises)
                .then(function () {
                    MessageToast.show("Deleted " + aPromises.length + " configuration row(s).");
                    return Promise.all([
                        this._loadConfigTableData(),
                        this._loadRoleTemplateOptions()
                    ]);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "deleteFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        }
    });
});
