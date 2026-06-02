sap.ui.define([
    "dwcmission/plantlocationapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/ui/core/routing/History"
], function (BaseController, JSONModel, MessageBox, History) {
    "use strict";

    return BaseController.extend("dwcmission.plantlocationapp.controller.AlterTable", {
        onInit: function () {
            this.getRouter().getRoute("AlterTable").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function (oEvent) {
            var sTableName = oEvent.getParameter("arguments").table;

            var oViewModel = this.getModel("view");
            if (!oViewModel) {
                oViewModel = new JSONModel({
                    semanticTypeSuggestions: [
                        { key: "Plant", text: this.getText("semanticTypePlant") || "Plant" },
                        { key: "Company Code", text: this.getText("semanticTypeCompanyCode") || "Company Code" },
                        { key: "Sales Org", text: this.getText("semanticTypeSalesOrg") || "Sales Org" }
                    ]
                });
                this.getView().setModel(oViewModel, "view");
            }

            oViewModel.setProperty("/alterTable", {
                tableName: sTableName,
                fields: []
            });

            var sSelectedSchema = oViewModel.getProperty("/selectedSchema");

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
                oViewModel = this.getModel("view");

            // Automatically map semantic types to physical types
            if (sKey === "Plant" || sKey === "Company Code" || sKey === "Sales Org") {
                oViewModel.setProperty(sContextPath + "/type", "NVARCHAR");
                oViewModel.setProperty(sContextPath + "/length", 4);
                if (sKey === "Plant") {
                    oViewModel.setProperty(sContextPath + "/referenceTable", "I_Plant");
                    oViewModel.setProperty(sContextPath + "/referenceColumn", "Plant");
                } else if (sKey === "Company Code") {
                    oViewModel.setProperty(sContextPath + "/referenceTable", "I_CompanyCode");
                    oViewModel.setProperty(sContextPath + "/referenceColumn", "CompanyCode");
                }
            } else if (sKey === "Currency") {
                oViewModel.setProperty(sContextPath + "/type", "NVARCHAR");
                oViewModel.setProperty(sContextPath + "/length", 5);
            }
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
