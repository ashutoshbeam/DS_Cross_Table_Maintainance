sap.ui.define([
    "ztm/tmapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Input"
], function (BaseController, JSONModel, Filter, FilterOperator, MessageBox, MessageToast, Dialog, Button, Label, Input) {
    "use strict";

    return BaseController.extend("ztm.tmapp.controller.TableDesigner", {
        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                selectedSchema: "",
                schemaSelectItems: [],
                tables: [],
                tableSelectItems: [],
                filteredTables: [],
                selectedTable: "",
                columns: []
            });

            this.getView().setModel(oViewModel, "view");

            this.getRouter().getRoute("TableDesigner").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function () {
            this._loadSchemas();
        },

        _loadSchemas: function () {
            this._setBusy(true);
            var oViewModel = this.getModel("view");

            this._request("api/schema-browser/schemas")
                .then(function (oResult) {
                    oViewModel.setProperty("/schemaSelectItems", oResult.schemas || []);
                    var sCurrentSchema = oResult.currentSchema || "";
                    oViewModel.setProperty("/selectedSchema", sCurrentSchema);
                    this._loadTables(sCurrentSchema);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "schemasLoadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _loadTables: function (sSchema) {
            this._setBusy(true);
            var oViewModel = this.getModel("view");
            var sUrl = "api/schema-browser/tables";
            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            this._request(sUrl)
                .then(function (oResult) {
                    var aTables = oResult.tables || [];
                    oViewModel.setProperty("/tables", aTables);
                    oViewModel.setProperty("/filteredTables", aTables);
                    oViewModel.setProperty("/tableSelectItems", aTables.map(function (oTable) {
                        return {
                            key: oTable.name,
                            text: oTable.label || oTable.name
                        };
                    }));
                    oViewModel.setProperty("/selectedTable", "");
                    oViewModel.setProperty("/columns", []);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "tablesLoadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onSchemaChange: function () {
            var sSchema = this.getModel("view").getProperty("/selectedSchema");
            this._loadTables(sSchema);
        },

        onTableValueHelp: function () {
            this.byId("tableSelectDialog").open();
        },

        onTableSelectSearch: function (oEvent) {
            var sValue = oEvent.getParameter("value");
            var oBinding = oEvent.getParameter("itemsBinding");
            var aFilters = sValue ? [
                new Filter({
                    filters: [
                        new Filter("text", FilterOperator.Contains, sValue),
                        new Filter("key", FilterOperator.Contains, sValue)
                    ],
                    and: false
                })
            ] : [];

            oBinding.filter(aFilters);
        },

        onTableSelectConfirm: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");

            if (!oSelectedItem) {
                return;
            }

            this._loadTableMetadata(oSelectedItem.getDescription());
        },

        _loadTableMetadata: function (sTableName) {
            this._setBusy(true);
            var oViewModel = this.getModel("view");
            var sSchema = oViewModel.getProperty("/selectedSchema");

            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/metadata";
            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            this._request(sUrl)
                .then(function (oResult) {
                    oViewModel.setProperty("/selectedTable", sTableName);
                    var aColumns = (oResult.columns || []).map(function (col) {
                        return {
                            name: col.name,
                            type: col.type,
                            length: col.length || null,
                            scale: col.scale || null,
                            key: !!col.key,
                            nullable: !col.key && col.nullable,
                            semanticType: col.semanticType || "",
                            valueHelpRequired: !!col.valueHelpRequired,
                            referenceTable: col.referenceTable || "",
                            referenceColumn: col.referenceColumn || "",
                            comment: col.comment || ""
                        };
                    });
                    oViewModel.setProperty("/columns", aColumns);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "loadColumnsFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onCreateTablePress: function () {
            var sSelectedSchema = this.getModel("view").getProperty("/selectedSchema");
            this.getOwnerComponent()._sSelectedTemplateRole = "BASIC_DATA"; // Default
            this.getRouter().navTo("CreateTable");
        },

        onAlterTablePress: function () {
            var sTable = this.getModel("view").getProperty("/selectedTable");
            if (!sTable) {
                return;
            }
            this.getRouter().navTo("AlterTable", {
                table: sTable
            });
        },

        onDuplicateTablePress: function () {
            var sSourceTable = this.getModel("view").getProperty("/selectedTable");
            if (!sSourceTable) {
                return;
            }

            var oInput = new Input({
                width: "100%",
                placeholder: "e.g. ZMM_INVENTORY_CLONE"
            });

            var oDialog = new Dialog({
                title: "Duplicate Table: " + sSourceTable,
                type: "Message",
                content: [
                    new Label({ text: "New Table Name" }),
                    oInput
                ],
                beginButton: new Button({
                    type: "Emphasized",
                    text: "Duplicate",
                    press: function () {
                        var sNewTable = oInput.getValue();
                        if (!sNewTable || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(sNewTable)) {
                            MessageBox.error("Please enter a valid SAP-compliant table name.");
                            return;
                        }
                        oDialog.close();
                        this._duplicateTable(sSourceTable, sNewTable);
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

            oDialog.open();
        },

        _duplicateTable: function (sSourceTable, sNewTable) {
            this._setBusy(true);
            var oViewModel = this.getModel("view");
            var sSchema = oViewModel.getProperty("/selectedSchema");
            var aColumns = oViewModel.getProperty("/columns") || [];

            var aFields = aColumns.map(function (col) {
                return {
                    name: col.name,
                    type: col.type,
                    length: col.length,
                    scale: col.scale,
                    isPrimary: col.key,
                    isNotNull: !col.nullable,
                    semanticType: col.semanticType,
                    referenceTable: col.referenceTable,
                    referenceColumn: col.referenceColumn,
                    valueHelpRequired: col.valueHelpRequired,
                    comment: col.comment || "Cloned from " + sSourceTable
                };
            });

            var oPayload = {
                schemaName: sSchema,
                tableName: sNewTable,
                tableType: "COLUMN",
                tableComment: "Duplicate of " + sSourceTable,
                fields: aFields,
                includeCuid: false,
                includeManaged: false,
                includeTemporal: false,
                includeCodeList: false
            };

            this._request("api/schema-browser/tables", {
                method: "POST",
                body: JSON.stringify(oPayload)
            })
                .then(function () {
                    MessageToast.show("Table duplicated successfully to " + sNewTable);
                    this._loadTables(sSchema);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "createTableFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onDeleteTablePress: function () {
            var sTableName = this.getModel("view").getProperty("/selectedTable");
            var sSchema = this.getModel("view").getProperty("/selectedSchema");
            if (!sTableName) {
                return;
            }

            MessageBox.confirm("Are you sure you want to permanently drop the table '" + sTableName + "'? This operation CANNOT be undone and will delete all associated data.", {
                actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.DELETE,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.DELETE) {
                        this._deleteTable(sTableName, sSchema);
                    }
                }.bind(this)
            });
        },

        _deleteTable: function (sTableName, sSchema) {
            this._setBusy(true);
            var sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName);
            if (sSchema) {
                sUrl += "?schemaName=" + encodeURIComponent(sSchema);
            }

            this._request(sUrl, {
                method: "DELETE"
            })
                .then(function () {
                    MessageToast.show("Table " + sTableName + " dropped successfully.");
                    this._loadTables(sSchema);
                }.bind(this))
                .catch(this._handleActionError.bind(this, "dropTableFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        }
    });
});
