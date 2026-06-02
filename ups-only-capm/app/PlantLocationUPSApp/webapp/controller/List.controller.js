sap.ui.define([
    "upsonly/tablemaintenanceapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox"
], function (BaseController, JSONModel, Filter, FilterOperator, MessageBox) {
    "use strict";

    return BaseController.extend("upsonly.tablemaintenanceapp.controller.List", {
        onInit: function () {
            this.setModel(new JSONModel({
                search: "",
                tableTitle: this.getText("tableTitle"),
                selectedCount: 0,
                busy: false,
                createEdit: this._getEmptyFormData()
            }), "view");
        },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue") || "");
            this._applyFilters();
        },

        onRefresh: function () {
            this._setBusy(true);
            this._refreshTable()
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

        onUpdateFinished: function (oEvent) {
            this._updateTableTitle(oEvent.getParameter("total"));
            this._updateSelectionState();
        },

        onCreate: function () {
            this.getModel("view").setProperty("/createEdit", this._getEmptyFormData());
            this.getModel("view").setProperty("/createEdit/mode", "create");
            this.byId("createEditDialog").open();
        },

        onEdit: function () {
            var aContexts = this._getSelectedContexts(),
                oContext = aContexts[0];

            if (aContexts.length !== 1) {
                this.showToast(this.getText("selectSingleRecord"));
                return;
            }

            this.getModel("view").setProperty("/createEdit", {
                mode: "edit",
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

            if (!this._validatePayload(oPayload, sMode === "create")) {
                return;
            }

            this._setBusy(true);

            if (sMode === "create") {
                this._createEntry(oPayload)
                    .then(function () {
                        this.byId("createEditDialog").close();
                        this.showToast(this.getText("createSuccess", [oPayload.plant]));
                    }.bind(this))
                    .catch(this._handleMutationError.bind(this, "createFailed"))
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
                .catch(this._handleMutationError.bind(this, "updateFailed"))
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

        _applyFilters: function () {
            var oBinding = this._getTableBinding(),
                sSearch = this.getModel("view").getProperty("/search"),
                aFilters;

            if (!oBinding) {
                return;
            }

            aFilters = sSearch ? [new Filter({
                filters: [
                    new Filter("PLANT", FilterOperator.Contains, sSearch),
                    new Filter("COMPANY_CODE", FilterOperator.Contains, sSearch),
                    new Filter("LOCATION", FilterOperator.Contains, sSearch),
                    new Filter("LOCATION_TYPE", FilterOperator.Contains, sSearch),
                    new Filter("REGION", FilterOperator.Contains, sSearch)
                ],
                and: false
            })] : [];

            oBinding.filter(aFilters);
        },

        _createEntry: function (oPayload) {
            var oContext = this._getTableBinding().create({
                PLANT: oPayload.plant,
                COMPANY_CODE: oPayload.companyCode,
                LOCATION: oPayload.location,
                LOCATION_TYPE: oPayload.locationType,
                REGION: oPayload.region
            }, true);

            return this.submitBatch()
                .then(function () {
                    return oContext.created();
                })
                .then(function () {
                    return this._afterMutation();
                }.bind(this));
        },

        _updateEntry: function (oContext, oPayload) {
            oContext.setProperty("COMPANY_CODE", oPayload.companyCode);
            oContext.setProperty("LOCATION", oPayload.location);
            oContext.setProperty("LOCATION_TYPE", oPayload.locationType);
            oContext.setProperty("REGION", oPayload.region);

            return this.submitBatch().then(function () {
                return this._afterMutation();
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
                    return this._afterMutation();
                }.bind(this))
                .then(function () {
                    this.showToast(this.getText("deleteSuccess", [aContexts.length]));
                }.bind(this))
                .catch(this._handleMutationError.bind(this, "deleteFailed"))
                .finally(function () {
                    this._setBusy(false);
                }.bind(this));
        },

        _afterMutation: function () {
            this.byId("plantTable").removeSelections(true);
            this._updateSelectionState();
            return this._refreshTable();
        },

        _refreshTable: function () {
            var oBinding = this._getTableBinding(),
                iLength;

            if (!oBinding) {
                return Promise.resolve();
            }

            oBinding.refresh();
            iLength = Math.max(oBinding.getCurrentContexts().length, 1);

            if (oBinding.requestContexts) {
                return oBinding.requestContexts(0, iLength).then(function () {
                    this._updateTableTitle();
                }.bind(this));
            }

            this._updateTableTitle();
            return Promise.resolve();
        },

        _updateTableTitle: function (iTotal) {
            var oBinding = this._getTableBinding(),
                iResolvedTotal = iTotal,
                sTitle;

            if (typeof iResolvedTotal !== "number" && oBinding) {
                iResolvedTotal = oBinding.getLength();
            }

            sTitle = typeof iResolvedTotal === "number" && iResolvedTotal >= 0
                ? this.getText("tableTitleCount", [iResolvedTotal])
                : this.getText("tableTitle");

            this.getModel("view").setProperty("/tableTitle", sTitle);
        },

        _resetPendingChanges: function () {
            var oModel = this.getOwnerComponent().getModel();

            if (oModel.hasPendingChanges("plantLocationGroup")) {
                oModel.resetChanges("plantLocationGroup");
            }

            return this._refreshTable();
        },

        _handleMutationError: function (sMessageKey, oError) {
            return this._resetPendingChanges()
                .catch(function () {
                    return undefined;
                })
                .then(function () {
                    this._handleActionError(sMessageKey, oError);
                }.bind(this));
        },

        _handleActionError: function (sMessageKey, oError) {
            this.showError(this.getText(sMessageKey), oError && (oError.message || oError.toString()));
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
                plant: "",
                companyCode: "",
                location: "",
                locationType: "",
                region: ""
            };
        },

        _validatePayload: function (oPayload, bCheckPlant) {
            if (bCheckPlant && !oPayload.plant) {
                this.showToast(this.getText("plantRequired"));
                return false;
            }
            if (!oPayload.companyCode || !oPayload.location) {
                this.showToast(this.getText("requiredFieldsMissing"));
                return false;
            }

            return true;
        }
    });
});
