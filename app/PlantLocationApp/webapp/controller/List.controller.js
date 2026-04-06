sap.ui.define([
    "dwcmission/plantlocationapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox"
], function (BaseController, JSONModel, Filter, FilterOperator, MessageBox) {
    "use strict";

    return BaseController.extend("dwcmission.plantlocationapp.controller.List", {
        onInit: function () {
            this.setModel(new JSONModel({
                filters: {
                    plant: "",
                    companyCode: "",
                    location: "",
                    locationType: "",
                    region: ""
                },
                search: "",
                tableTitle: this.getText("tableTitle"),
                selectedCount: 0,
                busy: false,
                createEdit: this._getEmptyFormData(),
                multiUpdate: this._getEmptyBulkData(),
                upload: {
                    fileName: "",
                    rows: [],
                    previewText: ""
                }
            }), "view");
        },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue") || "");
            this._applyFilters();
        },

        onApplyFilters: function () {
            this._applyFilters();
        },

        onClearFilters: function () {
            var oViewModel = this.getModel("view");

            oViewModel.setProperty("/search", "");
            oViewModel.setProperty("/filters", {
                plant: "",
                companyCode: "",
                location: "",
                locationType: "",
                region: ""
            });
            this._applyFilters();
        },

        onRefresh: function () {
            this._getTableBinding().refresh();
            this.showToast(this.getText("refreshTriggered"));
        },

        onSelectionChange: function () {
            this._updateSelectionState();
        },

        onItemPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext(),
                sPlant = oContext.getProperty("PLANT");

            this.getRouter().navTo("PlantLocationObjectPage", {
                plant: encodeURIComponent(sPlant)
            });
        },

        onUpdateFinished: function (oEvent) {
            var iTotal = oEvent.getParameter("total"),
                sTitle = iTotal ? this.getText("tableTitleCount", [iTotal]) : this.getText("tableTitle");

            this.getModel("view").setProperty("/tableTitle", sTitle);
            this._updateSelectionState();
        },

        onCreate: function () {
            var oViewModel = this.getModel("view");

            oViewModel.setProperty("/createEdit", this._getEmptyFormData());
            oViewModel.setProperty("/createEdit/mode", "create");
            this.byId("createEditDialog").open();
        },

        onEdit: function () {
            var aContexts = this._getSelectedContexts(),
                oContext = aContexts[0],
                oViewModel = this.getModel("view");

            if (aContexts.length !== 1) {
                this.showToast(this.getText("selectSingleRecord"));
                return;
            }

            oViewModel.setProperty("/createEdit", {
                mode: "edit",
                contextPath: oContext.getPath(),
                plant: oContext.getProperty("PLANT"),
                companyCode: oContext.getProperty("COMPANY_CODE"),
                location: oContext.getProperty("LOCATION"),
                locationType: oContext.getProperty("LOCATION_TYPE"),
                region: oContext.getProperty("REGION")
            });

            this.byId("createEditDialog").open();
        },

        onSaveCreateEdit: function () {
            var oPayload = this.getModel("view").getProperty("/createEdit"),
                sMode = oPayload.mode;

            if (!this._validateSinglePayload(oPayload, sMode === "create")) {
                return;
            }

            this._setBusy(true);

            if (sMode === "create") {
                this._createEntry(oPayload)
                    .then(function () {
                        this.byId("createEditDialog").close();
                        this.showToast(this.getText("createSuccess", [oPayload.plant]));
                    }.bind(this))
                    .catch(this._handleActionError.bind(this, "createFailed"))
                    .finally(function () {
                        this._setBusy(false);
                    }.bind(this));
                return;
            }

            this._updateEntry(this._getSelectedContexts()[0], oPayload)
                .then(function () {
                    this.byId("createEditDialog").close();
                    this.showToast(this.getText("updateSuccess", [oPayload.plant]));
                }.bind(this))
                .catch(this._handleActionError.bind(this, "updateFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onCancelCreateEdit: function () {
            this.byId("createEditDialog").close();
        },

        onDelete: function () {
            var aContexts = this._getSelectedContexts();

            if (!aContexts.length) {
                this.showToast(this.getText("selectAtLeastOne"));
                return;
            }

            MessageBox.confirm(this.getText("deleteConfirm", [aContexts.length]), {
                actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.DELETE,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.DELETE) {
                        this._deleteEntries(aContexts);
                    }
                }.bind(this)
            });
        },

        onOpenMultiUpdate: function () {
            if (this._getSelectedContexts().length < 2) {
                this.showToast(this.getText("selectMultipleRecords"));
                return;
            }

            this.getModel("view").setProperty("/multiUpdate", this._getEmptyBulkData());
            this.byId("multiUpdateDialog").open();
        },

        onApplyMultiUpdate: function () {
            var aContexts = this._getSelectedContexts(),
                oChanges = this.getModel("view").getProperty("/multiUpdate");

            if (!this._hasBulkChanges(oChanges)) {
                this.showToast(this.getText("enterBulkChange"));
                return;
            }

            this._setBusy(true);
            this._multiUpdateEntries(aContexts, oChanges)
                .then(function () {
                    this.byId("multiUpdateDialog").close();
                    this.showToast(this.getText("multiUpdateSuccess", [aContexts.length]));
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
                previewText: ""
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
                        previewText: this.getText("uploadPreviewRows", [aRows.length])
                    });
                }.bind(this))
                .catch(this._handleActionError.bind(this, "uploadReadFailed"));
        },

        onDownloadTemplate: function () {
            var sTemplate = "PLANT,COMPANY_CODE,LOCATION,LOCATION_TYPE,REGION\n1000,1000,Main Plant,Factory,North\n",
                oBlob = new Blob([sTemplate], { type: "text/csv;charset=utf-8" }),
                sUrl = URL.createObjectURL(oBlob),
                oLink = document.createElement("a");

            oLink.href = sUrl;
            oLink.download = "plant-location-template.csv";
            oLink.click();
            URL.revokeObjectURL(sUrl);
        },

        onStartMassUpload: function () {
            var aRows = this.getModel("view").getProperty("/upload/rows") || [],
                aValidRows = aRows.filter(function (oRow) {
                    return oRow.PLANT && oRow.COMPANY_CODE && oRow.LOCATION;
                });

            if (!aValidRows.length) {
                this.showToast(this.getText("uploadNoRows"));
                return;
            }

            this._setBusy(true);
            this._massCreateEntries(aValidRows)
                .then(function () {
                    this.byId("massUploadDialog").close();
                    this.showToast(this.getText("uploadSuccess", [aValidRows.length]));
                }.bind(this))
                .catch(this._handleActionError.bind(this, "uploadFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        onCancelMassUpload: function () {
            this.byId("massUploadDialog").close();
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view"),
                oFilters = oViewModel.getProperty("/filters"),
                sSearch = oViewModel.getProperty("/search"),
                aFieldFilters = [],
                aSearchFilters = [],
                oBinding = this._getTableBinding();

            if (oFilters.plant) {
                aFieldFilters.push(new Filter("PLANT", FilterOperator.Contains, oFilters.plant));
            }
            if (oFilters.companyCode) {
                aFieldFilters.push(new Filter("COMPANY_CODE", FilterOperator.Contains, oFilters.companyCode));
            }
            if (oFilters.location) {
                aFieldFilters.push(new Filter("LOCATION", FilterOperator.Contains, oFilters.location));
            }
            if (oFilters.locationType) {
                aFieldFilters.push(new Filter("LOCATION_TYPE", FilterOperator.Contains, oFilters.locationType));
            }
            if (oFilters.region) {
                aFieldFilters.push(new Filter("REGION", FilterOperator.Contains, oFilters.region));
            }

            if (sSearch) {
                aSearchFilters = [
                    new Filter("PLANT", FilterOperator.Contains, sSearch),
                    new Filter("COMPANY_CODE", FilterOperator.Contains, sSearch),
                    new Filter("LOCATION", FilterOperator.Contains, sSearch),
                    new Filter("LOCATION_TYPE", FilterOperator.Contains, sSearch),
                    new Filter("REGION", FilterOperator.Contains, sSearch)
                ];
            }

            if (aSearchFilters.length) {
                aFieldFilters.push(new Filter({
                    filters: aSearchFilters,
                    and: false
                }));
            }

            oBinding.filter(aFieldFilters);
        },

        _getTableBinding: function () {
            return this.byId("plantTable").getBinding("items");
        },

        _getSelectedContexts: function () {
            return this.byId("plantTable").getSelectedContexts();
        },

        _updateSelectionState: function () {
            this.getModel("view").setProperty("/selectedCount", this._getSelectedContexts().length);
        },

        _setBusy: function (bBusy) {
            this.getModel("view").setProperty("/busy", bBusy);
            this.getView().setBusy(bBusy);
        },

        _getEmptyFormData: function () {
            return {
                mode: "create",
                contextPath: "",
                plant: "",
                companyCode: "",
                location: "",
                locationType: "",
                region: ""
            };
        },

        _getEmptyBulkData: function () {
            return {
                companyCode: "",
                location: "",
                locationType: "",
                region: ""
            };
        },

        _validateSinglePayload: function (oPayload, bCheckPlant) {
            if (bCheckPlant && !oPayload.plant) {
                this.showToast(this.getText("plantRequired"));
                return false;
            }
            if (!oPayload.companyCode || !oPayload.location) {
                this.showToast(this.getText("requiredFieldsMissing"));
                return false;
            }

            return true;
        },

        _createEntry: function (oPayload) {
            var oBinding = this._getTableBinding(),
                oContext = oBinding.create({
                    PLANT: oPayload.plant,
                    COMPANY_CODE: oPayload.companyCode,
                    LOCATION: oPayload.location,
                    LOCATION_TYPE: oPayload.locationType,
                    REGION: oPayload.region
                }, true);

            return this.submitBatch().then(function () {
                return oContext.created();
            }).then(function () {
                this._afterMutation();
            }.bind(this));
        },

        _updateEntry: function (oContext, oPayload) {
            if (!oContext && oPayload.contextPath) {
                oContext = this.getOwnerComponent().getModel().bindContext(oPayload.contextPath).getBoundContext();
            }

            if (!oContext) {
                return Promise.reject(new Error(this.getText("recordContextMissing")));
            }

            oContext.setProperty("COMPANY_CODE", oPayload.companyCode);
            oContext.setProperty("LOCATION", oPayload.location);
            oContext.setProperty("LOCATION_TYPE", oPayload.locationType);
            oContext.setProperty("REGION", oPayload.region);

            return this.submitBatch().then(function () {
                this._afterMutation();
            }.bind(this));
        },

        _deleteEntries: function (aContexts) {
            var aDeletePromises;

            this._setBusy(true);
            aDeletePromises = aContexts.map(function (oContext) {
                return oContext.delete("plantLocationGroup");
            });

            this.submitBatch()
                .then(function () {
                    return Promise.all(aDeletePromises);
                })
                .then(function () {
                    this._afterMutation();
                    this.showToast(this.getText("deleteSuccess", [aContexts.length]));
                }.bind(this))
                .catch(this._handleActionError.bind(this, "deleteFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _multiUpdateEntries: function (aContexts, oChanges) {
            aContexts.forEach(function (oContext) {
                if (oChanges.companyCode) {
                    oContext.setProperty("COMPANY_CODE", oChanges.companyCode);
                }
                if (oChanges.location) {
                    oContext.setProperty("LOCATION", oChanges.location);
                }
                if (oChanges.locationType) {
                    oContext.setProperty("LOCATION_TYPE", oChanges.locationType);
                }
                if (oChanges.region) {
                    oContext.setProperty("REGION", oChanges.region);
                }
            });

            return this.submitBatch().then(function () {
                this._afterMutation();
            }.bind(this));
        },

        _massCreateEntries: function (aRows) {
            var oBinding = this._getTableBinding(),
                aCreatedContexts = aRows.map(function (oRow) {
                    return oBinding.create(oRow, true);
                });

            return this.submitBatch().then(function () {
                return Promise.all(aCreatedContexts.map(function (oContext) {
                    return oContext.created();
                }));
            }).then(function () {
                this._afterMutation();
            }.bind(this));
        },

        _afterMutation: function () {
            this.byId("plantTable").removeSelections(true);
            this._updateSelectionState();
            this._getTableBinding().refresh();
        },

        _hasBulkChanges: function (oChanges) {
            return Object.keys(oChanges).some(function (sKey) {
                return !!oChanges[sKey];
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

            aHeaders = aLines[0].split(",").map(function (sHeader) {
                return sHeader.trim().toUpperCase();
            });

            aRows = aLines.slice(1).map(function (sLine) {
                var aValues = sLine.split(","),
                    oRow = {};

                aHeaders.forEach(function (sHeader, iIndex) {
                    oRow[sHeader] = (aValues[iIndex] || "").trim();
                });

                return {
                    PLANT: oRow.PLANT || "",
                    COMPANY_CODE: oRow.COMPANY_CODE || "",
                    LOCATION: oRow.LOCATION || "",
                    LOCATION_TYPE: oRow.LOCATION_TYPE || "",
                    REGION: oRow.REGION || ""
                };
            });

            return aRows;
        },

        _handleActionError: function (sMessageKey, oError) {
            this.showError(this.getText(sMessageKey), oError && (oError.message || oError.toString()));
        }
    });
});
