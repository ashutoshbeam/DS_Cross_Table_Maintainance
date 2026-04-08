sap.ui.define([
    "dwcmission/plantlocationapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/Text",
    "sap/ui/layout/form/SimpleForm"
], function (BaseController, JSONModel, MessageBox, Column, ColumnListItem, Input, Label, Text, SimpleForm) {
    "use strict";

    return BaseController.extend("dwcmission.plantlocationapp.controller.List", {
        onInit: function () {
            this.setModel(new JSONModel({
                busy: false,
                tables: [],
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
                }
            }), "view");

            this._loadTables();
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

            this._buildCreateEditForm();
            this.byId("createEditDialog").open();
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

            this._buildCreateEditForm();
            this.byId("createEditDialog").open();
        },

        onSaveCreateEdit: function () {
            var oViewModel = this.getModel("view"),
                oPayload = oViewModel.getProperty("/createEdit"),
                sTableName = this._getSelectedTableName(),
                sMethod = oPayload.mode === "create" ? "POST" : "PATCH",
                sUrl = "api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/rows",
                oBody;

            if (!this._validateCreateEdit(oPayload)) {
                return;
            }

            oBody = oPayload.mode === "create"
                ? { data: oPayload.values }
                : { keys: oPayload.originalKeys, data: oPayload.values };

            this._setBusy(true);
            this._request(sUrl, {
                method: sMethod,
                body: JSON.stringify(oBody)
            })
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
                sTableName = this._getSelectedTableName();

            if (!aRows.length) {
                this.showToast(this.getText("selectAtLeastOne"));
                return;
            }

            MessageBox.confirm(this.getText("deleteConfirmGeneric", [aRows.length, sTableName]), {
                actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.DELETE,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.DELETE) {
                        this._deleteSelectedRows(aRows);
                    }
                }.bind(this)
            });
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

            this._buildMultiUpdateForm();
            this.byId("multiUpdateDialog").open();
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
            var sTemplate = this._getColumns().map(function (column) {
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
                aKeyColumns = this.getModel("view").getProperty("/keyColumns") || [],
                aValidRows = aRows.filter(function (row) {
                    return aKeyColumns.every(function (key) {
                        return !!row[key];
                    });
                }),
                sTableName = this._getSelectedTableName();

            if (!aValidRows.length) {
                this.showToast(this.getText("uploadNoRows"));
                return;
            }

            this._setBusy(true);
            this._request("api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/mass-upload", {
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

        _loadTables: function () {
            this._setBusy(true);
            return this._request("api/schema-browser/tables")
                .then(function (oResult) {
                    var oViewModel = this.getModel("view"),
                        aTables = oResult.tables || [];

                    oViewModel.setProperty("/tables", aTables);
                    oViewModel.setProperty("/schemaName", oResult.schemaName || "");

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

        _loadSelectedTable: function () {
            var sTableName = this._getSelectedTableName(),
                sSearch = this.getModel("view").getProperty("/search"),
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
            if (sSearch) {
                sUrl += "?search=" + encodeURIComponent(sSearch);
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
                oForm.addContent(new Label({ text: column.name }));
                oForm.addContent(new Input({
                    value: "{view>/createEdit/values/" + column.name + "}",
                    editable: bCreate || !column.key
                }));
            });
            oFormBox.addItem(oForm);
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
                oForm.addContent(new Input({
                    value: "{view>/multiUpdate/values/" + column.name + "}"
                }));
            });
            oFormBox.addItem(oForm);
        },

        _deleteSelectedRows: function (aRows) {
            var sTableName = this._getSelectedTableName();

            this._setBusy(true);
            Promise.all(aRows.map(function (row) {
                return this._request("api/schema-browser/tables/" + encodeURIComponent(sTableName) + "/rows", {
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

        _validateCreateEdit: function (oPayload) {
            var aKeyColumns = this.getModel("view").getProperty("/keyColumns") || [];

            if (oPayload.mode === "create" && !aKeyColumns.every(function (key) {
                return !!oPayload.values[key];
            })) {
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
                return !column.key;
            });
        },

        _getSelectedTableName: function () {
            return this.getModel("view").getProperty("/selectedTable");
        },

        _setBusy: function (bBusy) {
            this.getModel("view").setProperty("/busy", bBusy);
            this.getView().setBusy(bBusy);
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
