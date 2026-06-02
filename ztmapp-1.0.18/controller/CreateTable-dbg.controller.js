sap.ui.define([
    "ztm.app/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/ui/core/routing/History"
], function (BaseController, JSONModel, MessageBox, History) {
    "use strict";

    return BaseController.extend("ztm.app.controller.CreateTable", {
        onInit: function () {
            this.getRouter().getRoute("CreateTable").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function () {
            var oViewModel = this.getModel("view");
            if (!oViewModel) {
                oViewModel = new JSONModel({
                    semanticTypeSuggestions: [
                        { key: "Plant", text: this.getText("semanticTypePlant") || "Plant" },
                        { key: "Company Code", text: this.getText("semanticTypeCompanyCode") || "Company Code" },
                        { key: "Sales Org", text: this.getText("semanticTypeSalesOrg") || "Sales Org" }
                    ],
                    templateRoles: [
                        { key: "FACT", text: "Fact" },
                        { key: "DIMENSION", text: "Dimension" }
                    ]
                });
                this.getView().setModel(oViewModel, "view");
            }
            
            oViewModel.setProperty("/createTable", {
                tableName: "",
                tableType: "COLUMN",
                templateRole: "",
                tableComment: "",
                includeCuid: true,
                includeManaged: true,
                includeTemporal: false,
                includeCodeList: false,
                fields: []
            });
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
