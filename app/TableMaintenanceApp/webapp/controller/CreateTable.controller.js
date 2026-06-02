sap.ui.define([
    "ztm/tmapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/ui/core/routing/History"
], function (BaseController, JSONModel, MessageBox, History) {
    "use strict";

    return BaseController.extend("ztm.tmapp.controller.CreateTable", {
        onInit: function () {
            var oViewModel = new JSONModel({
                semanticTypeSuggestions: [],
                semanticTypeConfigMap: {},
                templateRoles: [
                    { key: "DEMAND", text: "Demand" },
                    { key: "SUPPLY", text: "Supply" },
                    { key: "BASIC_DATA", text: "Basic Data" }
                ]
            });
            this.getView().setModel(oViewModel, "view");

            this.getRouter().getRoute("CreateTable").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function () {
            var oViewModel = this.getModel("view");
            var sTemplateRole = this.getOwnerComponent()._sSelectedTemplateRole || "";
            
            oViewModel.setProperty("/createTable", {
                tableName: "",
                tableType: "COLUMN",
                templateRole: sTemplateRole,
                tableComment: "",
                includeCuid: true,
                includeManaged: true,
                includeTemporal: false,
                includeCodeList: false,
                fields: [],
                validationRules: []
            });

            this._loadSemanticTypeConfig();
        },

        onNavBack: function () {
            var oHistory = History.getInstance();
            var sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getRouter().navTo("PlantLocationList", {}, true);
            }
        },

        onAddTableColumn: function () {
            var oViewModel = this.getModel("view");
            var aFields = oViewModel.getProperty("/createTable/fields") || [];
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
            oViewModel.setProperty("/createTable/fields", aFields);
        },

        onRemoveTableColumn: function (oEvent) {
            var oItem = oEvent.getParameter("listItem"),
                sPath = oItem.getBindingContext("view").getPath(),
                iIndex = parseInt(sPath.split("/").pop(), 10),
                oViewModel = this.getModel("view"),
                aFields = oViewModel.getProperty("/createTable/fields") || [];
                
            aFields.splice(iIndex, 1);
            oViewModel.setProperty("/createTable/fields", aFields);
        },

        onFieldSemanticTypeChange: function (oEvent) {
            var oComboBox = oEvent.getSource(),
                sKey = oComboBox.getSelectedKey() || oComboBox.getValue(),
                sContextPath = oComboBox.getBindingContext("view").getPath(),
                oViewModel = this.getModel("view"),
                oConfigMap = oViewModel.getProperty("/semanticTypeConfigMap") || {},
                oConfig = oConfigMap[sKey];

            if (oConfig) {
                oViewModel.setProperty(sContextPath + "/referenceTable", oConfig.referenceTable || "");
                oViewModel.setProperty(sContextPath + "/referenceColumn", oConfig.referenceColumn || "");
                oViewModel.setProperty(sContextPath + "/valueHelpRequired", !!(oConfig.referenceTable && oConfig.referenceColumn));

                if (oConfig.maxLength) {
                    oViewModel.setProperty(sContextPath + "/length", oConfig.maxLength);
                } else if (oConfig.referenceColumn && /companycode|salesorg|plant/i.test(oConfig.referenceColumn)) {
                    oViewModel.setProperty(sContextPath + "/length", 4);
                }

                if (oConfig.referenceTable || oConfig.referenceColumn) {
                    oViewModel.setProperty(sContextPath + "/type", "NVARCHAR");
                }
            } else {
                oViewModel.setProperty(sContextPath + "/referenceTable", "");
                oViewModel.setProperty(sContextPath + "/referenceColumn", "");
                oViewModel.setProperty(sContextPath + "/valueHelpRequired", false);
            }
        },

        _loadSemanticTypeConfig: function () {
            var oViewModel = this.getModel("view"),
                sSchema = oViewModel.getProperty("/selectedSchema"),
                sUrl = "api/schema-browser/tables/ZSCHEMA_VALUE_HELP_CONFIG/rows";

            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            return this._request(sUrl)
                .then(function (oResult) {
                    var aRows = oResult.rows || [],
                        oConfigMap = {},
                        aSuggestions = aRows
                            .map(function (oRow) {
                                var sSemanticType = String(oRow.SEMANTIC_TYPE || "").trim();

                                if (!sSemanticType) {
                                    return null;
                                }

                                oConfigMap[sSemanticType] = {
                                    referenceTable: oRow.REFERENCE_TABLE || "",
                                    referenceColumn: oRow.REFERENCE_COLUMN || "",
                                    maxLength: null
                                };

                                return {
                                    key: sSemanticType,
                                    text: sSemanticType
                                };
                            })
                            .filter(Boolean)
                            .sort(function (a, b) {
                                return a.text.localeCompare(b.text);
                            });

                    oViewModel.setProperty("/semanticTypeSuggestions", aSuggestions);
                    oViewModel.setProperty("/semanticTypeConfigMap", oConfigMap);
                })
                .catch(function () {
                    oViewModel.setProperty("/semanticTypeSuggestions", []);
                    oViewModel.setProperty("/semanticTypeConfigMap", {});
                });
        },

        onTemplateChange: function (oEvent) {
            var sKey = oEvent.getParameter("selectedItem").getKey(),
                oViewModel = this.getModel("view"),
                aFields = [];

            if (sKey === "PLANT_MAPPING") {
                aFields = [
                    { name: "PLANT", semanticType: "Plant", type: "NVARCHAR", length: 4, scale: null, isPrimary: true, isNotNull: true, referenceTable: "I_Plant", referenceColumn: "Plant", aliases: "PLANT", valueHelpRequired: true, defaultValue: "", comment: "Plant Code" },
                    { name: "COMPANY_CODE", semanticType: "Company Code", type: "NVARCHAR", length: 4, scale: null, isPrimary: false, isNotNull: true, referenceTable: "I_CompanyCode", referenceColumn: "CompanyCode", aliases: "COMPANY_CODE", valueHelpRequired: true, defaultValue: "", comment: "Company Code" },
                    { name: "LOCATION", semanticType: "", type: "NVARCHAR", length: 50, scale: null, isPrimary: false, isNotNull: false, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Location Name" },
                    { name: "REGION", semanticType: "", type: "NVARCHAR", length: 20, scale: null, isPrimary: false, isNotNull: false, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Region" }
                ];
                oViewModel.setProperty("/createTable/templateRole", "BASIC_DATA");
                oViewModel.setProperty("/createTable/tableName", "ZPLANT_LOCATION");
                oViewModel.setProperty("/createTable/tableComment", "Plant and Location Mapping table");
            } else if (sKey === "PRODUCT_CATALOG") {
                aFields = [
                    { name: "PRODUCT_ID", semanticType: "", type: "NVARCHAR", length: 20, scale: null, isPrimary: true, isNotNull: true, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Product ID" },
                    { name: "NAME", semanticType: "", type: "NVARCHAR", length: 100, scale: null, isPrimary: false, isNotNull: true, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Product Name" },
                    { name: "CATEGORY", semanticType: "", type: "NVARCHAR", length: 30, scale: null, isPrimary: false, isNotNull: false, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Category" },
                    { name: "PRICE", semanticType: "", type: "DECIMAL", length: 10, scale: 2, isPrimary: false, isNotNull: false, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "0.00", comment: "Price" },
                    { name: "UOM", semanticType: "", type: "NVARCHAR", length: 3, scale: null, isPrimary: false, isNotNull: false, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "PC", comment: "Unit of Measure" }
                ];
                oViewModel.setProperty("/createTable/templateRole", "BASIC_DATA");
                oViewModel.setProperty("/createTable/tableName", "ZPRODUCT_CATALOG");
                oViewModel.setProperty("/createTable/tableComment", "Product Catalog details");
            } else if (sKey === "CUSTOMER_REGISTRY") {
                aFields = [
                    { name: "CUSTOMER_ID", semanticType: "", type: "NVARCHAR", length: 20, scale: null, isPrimary: true, isNotNull: true, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Customer ID" },
                    { name: "FIRST_NAME", semanticType: "", type: "NVARCHAR", length: 50, scale: null, isPrimary: false, isNotNull: true, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "First Name" },
                    { name: "LAST_NAME", semanticType: "", type: "NVARCHAR", length: 50, scale: null, isPrimary: false, isNotNull: true, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Last Name" },
                    { name: "EMAIL", semanticType: "", type: "NVARCHAR", length: 100, scale: null, isPrimary: false, isNotNull: false, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Email Address" },
                    { name: "PHONE", semanticType: "", type: "NVARCHAR", length: 20, scale: null, isPrimary: false, isNotNull: false, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Phone Number" }
                ];
                oViewModel.setProperty("/createTable/templateRole", "BASIC_DATA");
                oViewModel.setProperty("/createTable/tableName", "ZCUSTOMER_REGISTRY");
                oViewModel.setProperty("/createTable/tableComment", "Customer Registry database");
            } else if (sKey === "SYSTEM_LOGS") {
                aFields = [
                    { name: "LOG_ID", semanticType: "", type: "NVARCHAR", length: 36, scale: null, isPrimary: true, isNotNull: true, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Log Identifier" },
                    { name: "MESSAGE", semanticType: "", type: "NVARCHAR", length: 255, scale: null, isPrimary: false, isNotNull: true, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Log Message" },
                    { name: "SEVERITY", semanticType: "", type: "NVARCHAR", length: 10, scale: null, isPrimary: false, isNotNull: false, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "INFO", comment: "Log Severity" },
                    { name: "TIMESTAMP", semanticType: "", type: "TIMESTAMP", length: null, scale: null, isPrimary: false, isNotNull: true, referenceTable: "", referenceColumn: "", aliases: "", valueHelpRequired: false, defaultValue: "", comment: "Log Timestamp" }
                ];
                oViewModel.setProperty("/createTable/templateRole", "BASIC_DATA");
                oViewModel.setProperty("/createTable/tableName", "ZSYSTEM_AUDIT_LOGS");
                oViewModel.setProperty("/createTable/tableComment", "System Audit logs table");
            }

            oViewModel.setProperty("/createTable/fields", aFields);
            oViewModel.setProperty("/createTable/validationRules", []);
        },

        onSaveNewTable: function () {
            var oViewModel = this.getModel("view");
            var oPayload = oViewModel.getProperty("/createTable");

            if (!oPayload.tableName) {
                this.showToast(this.getText("tableNameRequired"));
                return;
            }

            if (!oPayload.templateRole) {
                MessageBox.error("Template Role is mandatory. Please select a Template Role.");
                return;
            }

            if ((!oPayload.fields || !oPayload.fields.length) && !oPayload.includeCuid && !oPayload.includeManaged && !oPayload.includeTemporal && !oPayload.includeCodeList) {
                this.showToast(this.getText("createTableNoFields"));
                return;
            }

            if (!this._validateTableFields(oPayload.fields || [])) {
                return;
            }

            var sSelectedSchema = oViewModel.getProperty("/selectedSchema");
            if (sSelectedSchema) {
                oPayload.schemaName = sSelectedSchema;
            }

            this._setBusy(true);
            this._request("api/schema-browser/tables", {
                method: "POST",
                body: JSON.stringify(oPayload)
            })
                .then(function () {
                    this.showToast(this.getText("createTableSuccess", [oPayload.tableName]));
                    // Navigate back to list
                    this.onNavBack();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "createTableFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _validateTableFields: function (aFields) {
            for (var i = 0; i < aFields.length; i++) {
                var oField = aFields[i];
                if (oField.name) {
                    oField.name = oField.name.trim();
                }
                if (!oField.name) {
                    this.showToast(this.getText("fieldNameRequired", [i + 1]));
                    return false;
                }
                if (!oField.type) {
                    this.showToast(this.getText("fieldTypeRequired", [i + 1]));
                    return false;
                }
                if (!/^[a-zA-Z_][a-zA-Z0-9_ ]*$/.test(oField.name)) {
                    this.showToast(this.getText("invalidFieldName", [oField.name]));
                    return false;
                }
            }
            return true;
        },

        onOpenValidationRules: function () {
            var oViewModel = this.getModel("view");
            var aFields = oViewModel.getProperty("/createTable/fields") || [];

            // Get columns (exclude fields without names)
            var aColumns = aFields.filter(function (f) {
                return !!f.name;
            }).map(function (f) {
                return { name: f.name.trim() };
            });

            if (!aColumns.length) {
                this.showToast(this.getText("createTableNoFields"));
                return;
            }

            oViewModel.setProperty("/columns", aColumns);

            // Copy validation rules so they can be canceled
            var aCurrentRules = oViewModel.getProperty("/createTable/validationRules") || [];
            var aRulesCopy = JSON.parse(JSON.stringify(aCurrentRules));
            oViewModel.setProperty("/validationRules", aRulesCopy);

            var oView = this.getView();
            if (this.byId("validationRulesDialog")) {
                this.byId("validationRulesDialog").open();
                return;
            }

            this.loadFragment({
                name: "ztm.tmapp.fragment.ValidationRulesDialog"
            }).then(function (oDialog) {
                oView.addDependent(oDialog);
                oDialog.open();
            }.bind(this));
        },

        onAddValidationRule: function () {
            var oViewModel = this.getModel("view");
            var aRules = oViewModel.getProperty("/validationRules") || [];
            var aColumns = oViewModel.getProperty("/columns") || [];

            aRules.push({
                columnName: aColumns.length ? aColumns[0].name : "",
                ruleType: "MANDATORY",
                ruleValue: "",
                errorMessage: ""
            });
            oViewModel.setProperty("/validationRules", aRules);
        },

        onDeleteValidationRule: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var sPath = oItem.getBindingContext("view").getPath();
            var iIndex = parseInt(sPath.split("/").pop(), 10);

            var oViewModel = this.getModel("view");
            var aRules = oViewModel.getProperty("/validationRules") || [];
            aRules.splice(iIndex, 1);
            oViewModel.setProperty("/validationRules", aRules);
        },

        onSaveValidationRules: function () {
            var oViewModel = this.getModel("view");
            var aRules = oViewModel.getProperty("/validationRules") || [];

            // Validation check
            for (var i = 0; i < aRules.length; i++) {
                var oRule = aRules[i];
                if (!oRule.columnName) {
                    MessageBox.error("Column Name is required for validation rules.");
                    return;
                }
                if (oRule.ruleType !== "MANDATORY" && !oRule.ruleValue) {
                    MessageBox.error("Validation Value is required for validation rules of type " + oRule.ruleType + ".");
                    return;
                }
            }

            // Save to /createTable/validationRules
            oViewModel.setProperty("/createTable/validationRules", aRules);
            this.byId("validationRulesDialog").close();
        },

        onCloseValidationRules: function () {
            this.byId("validationRulesDialog").close();
        }
    });
});
