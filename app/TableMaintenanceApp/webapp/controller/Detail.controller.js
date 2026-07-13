sap.ui.define([
    "ztm/tmapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox"
], function (BaseController, JSONModel, MessageBox) {
    "use strict";

    return BaseController.extend("ztm.tmapp.controller.Detail", {
        onInit: function () {
            this.setModel(new JSONModel({
                busy: false,
                editMode: false,
                canMaintain: false,
                isReadOnlyRole: false
            }), "view");

            this.getRouter().getRoute("PlantLocationObjectPage").attachPatternMatched(this.onObjectMatched, this);
            this._bindShellRoleState();
        },

        onObjectMatched: function (oEvent) {
            var sPlant = decodeURIComponent(oEvent.getParameter("arguments").plant),
                sEscapedPlant = sPlant.replace(/'/g, "''");

            this.getModel("view").setProperty("/editMode", false);
            this.getModel("view").setProperty("/busy", true);
            this.getView().setBusy(true);
            this.getView().bindElement({
                path: "/PlantLocation('" + sEscapedPlant + "')",
                parameters: {
                    $$updateGroupId: "plantLocationGroup"
                },
                events: {
                    dataRequested: function () {
                        this.getModel("view").setProperty("/busy", true);
                        this.getView().setBusy(true);
                    }.bind(this),
                    dataReceived: function () {
                        this.getModel("view").setProperty("/busy", false);
                        this.getView().setBusy(false);
                    }.bind(this)
                }
            });
        },

        onEdit: function () {
            if (!this._ensureCanMaintain()) {
                return;
            }
            this.getModel("view").setProperty("/editMode", true);
        },

        onUpdate: function () {
            if (!this._ensureCanMaintain()) {
                return;
            }
            this.getModel("view").setProperty("/busy", true);
            this.getView().setBusy(true);
            this.submitBatch()
                .then(function () {
                    return this._refreshDetail();
                }.bind(this))
                .then(function () {
                    this.getModel("view").setProperty("/editMode", false);
                    this.showToast(this.getText("detailUpdateSuccess"));
                }.bind(this))
                .catch(this._handleMutationError.bind(this, "detailUpdateFailed"))
                .finally(function () {
                    this.getModel("view").setProperty("/busy", false);
                    this.getView().setBusy(false);
                }.bind(this));
        },

        onDelete: function () {
            if (!this._ensureCanMaintain()) {
                return;
            }
            MessageBox.confirm(this.getText("detailDeleteConfirm"), {
                actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.DELETE,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.DELETE) {
                        this._deleteCurrentRecord();
                    }
                }.bind(this)
            });
        },

        onOpenChangeHistory: function () {
            var oContext = this.getView().getBindingContext(),
                sPlant;

            if (!oContext) {
                return;
            }

            sPlant = oContext.getProperty("PLANT");
            this.getRouter().navTo("PlantLocationChangeHistory", {
                plant: sPlant
            });
        },

        onCancelEdit: function () {
            var oContext = this.getView().getBindingContext();

            if (oContext) {
                oContext.getBinding().resetChanges();
            }

            this.getModel("view").setProperty("/editMode", false);
        },

        onNavBack: function () {
            this.getRouter().navTo("PlantLocationList");
        },

        _deleteCurrentRecord: function () {
            var oContext = this.getView().getBindingContext();

            if (!oContext) {
                return;
            }

            this.getModel("view").setProperty("/busy", true);
            this.getView().setBusy(true);
            oContext.delete("plantLocationGroup")
                .then(function () {
                    return this.submitBatch();
                }.bind(this))
                .then(function () {
                    this.showToast(this.getText("detailDeleteSuccess"));
                    this.getRouter().navTo("PlantLocationList");
                }.bind(this))
                .catch(this._handleMutationError.bind(this, "detailDeleteFailed"))
                .finally(function () {
                    this.getModel("view").setProperty("/busy", false);
                    this.getView().setBusy(false);
                }.bind(this));
        },

        _refreshDetail: function () {
            var oBinding = this.getView().getElementBinding();

            if (!oBinding) {
                return Promise.resolve();
            }

            oBinding.refresh();
            return Promise.resolve();
        },

        _resetPendingChanges: function () {
            var oModel = this.getOwnerComponent().getModel(),
                oBinding = this.getView().getElementBinding();

            if (oModel.hasPendingChanges("plantLocationGroup")) {
                oModel.resetChanges("plantLocationGroup");
            }

            if (oBinding) {
                oBinding.refresh();
            }

            return Promise.resolve();
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
                sRole = oShellModel && oShellModel.getProperty("/activeRoleProfile");

            if (!oShellModel || !sRole) {
                return;
            }

            this.getModel("view").setProperty("/canMaintain", sRole === "ZTM_Admin" || sRole === "ZTM_DataEngineer" || sRole === "ZTM_DataSteward");
            this.getModel("view").setProperty("/isReadOnlyRole", sRole === "ZTM_Display");
        },

        _ensureCanMaintain: function () {
            if (this.getModel("view").getProperty("/canMaintain")) {
                return true;
            }

            this.showToast(this.getText("displayModeBlocked"));
            return false;
        },

        _handleMutationError: function (sMessageKey, oError) {
            return this._resetPendingChanges()
                .catch(function () {
                    return undefined;
                })
                .then(function () {
                    this._handleError(sMessageKey, oError);
                }.bind(this));
        },

        _handleError: function (sMessageKey, oError) {
            this.showError(this.getText(sMessageKey), oError && (oError.message || oError.toString()));
        }
    });
});
