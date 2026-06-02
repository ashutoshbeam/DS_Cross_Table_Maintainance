sap.ui.define([
    "ztm/tmapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/ui/core/routing/History"
], function (BaseController, JSONModel, MessageBox, History) {
    "use strict";

    return BaseController.extend("ztm.tmapp.controller.AlterTable", {
        onInit: function () {
            this.getRouter().getRoute("AlterTable").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function (oEvent) {
            var sTableName = oEvent.getParameter("arguments").table;

            var oViewModel = this.getModel("view");
            if (!oViewModel) {
                oViewModel = new JSONModel({
                    semanticTypeSuggestions: [],
                    semanticTypeConfigMap: {}
                });
                this.getView().setModel(oViewModel, "view");
            }

            oViewModel.setProperty("/alterTable", {
                tableName: sTableName,
                fields: []
            });

            var sSelectedSchema = oViewModel.getProperty("/selectedSchema");
            this._loadSemanticTypeConfig();

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

                    oViewModel.setProperty("/alterTable", {
                        tableName: sTableName,
                        fields: aFields
                    });
                }.bind(this))
                .catch(this._handleActionError.bind(this, "loadColumnsFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
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

        onAddAlterTableColumn: function () {
            var oViewModel = this.getModel("view");
            var aFields = oViewModel.getProperty("/alterTable/fields") || [];
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
            oViewModel.setProperty("/alterTable/fields", aFields);
        },

        onRemoveAlterTableColumn: function (oEvent) {
            var oItem = oEvent.getParameter("listItem"),
                sPath = oItem.getBindingContext("view").getPath(),
                iIndex = parseInt(sPath.split("/").pop(), 10),
                oViewModel = this.getModel("view"),
                aFields = oViewModel.getProperty("/alterTable/fields") || [];
                
            aFields.splice(iIndex, 1);
            oViewModel.setProperty("/alterTable/fields", aFields);
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

        onSaveAlterTable: function () {
            var oViewModel = this.getModel("view");
            var oPayload = oViewModel.getProperty("/alterTable");

            if (!oPayload.fields || !oPayload.fields.length) {
                this.showToast(this.getText("createTableNoFields"));
                return;
            }

            if (!this._validateTableFields(oPayload.fields)) {
                return;
            }

            var sSelectedSchema = oViewModel.getProperty("/selectedSchema");
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
                    this.showToast(this.getText("alterTableSuccess", [oPayload.tableName]));
                    // Navigate back to list on success
                    this.onNavBack();
                }.bind(this))
                .catch(this._handleActionError.bind(this, "alterTableFailed"))
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
        }
    });
});
