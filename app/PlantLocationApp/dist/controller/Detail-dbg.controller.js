sap.ui.define([
    "dwcmission/plantlocationapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox"
], function (BaseController, JSONModel, MessageBox) {
    "use strict";

    return BaseController.extend("dwcmission.plantlocationapp.controller.Detail", {
        onInit: function () {
            this.setModel(new JSONModel({
                busy: false,
                editMode: false
            }), "view");

            this.getRouter().getRoute("PlantLocationObjectPage").attachPatternMatched(this.onObjectMatched, this);
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
            this.getModel("view").setProperty("/editMode", true);
        },

        onUpdate: function () {
            this.getModel("view").setProperty("/busy", true);
            this.getView().setBusy(true);
            this.submitBatch()
                .then(function () {
                    this.getModel("view").setProperty("/editMode", false);
                    this.showToast(this.getText("detailUpdateSuccess"));
                }.bind(this))
                .catch(this._handleError.bind(this, "detailUpdateFailed"))
                .finally(function () {
                    this.getModel("view").setProperty("/busy", false);
                    this.getView().setBusy(false);
                }.bind(this));
        },

        onDelete: function () {
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
                .catch(this._handleError.bind(this, "detailDeleteFailed"))
                .finally(function () {
                    this.getModel("view").setProperty("/busy", false);
                    this.getView().setBusy(false);
                }.bind(this));
        },

        _handleError: function (sMessageKey, oError) {
            this.showError(this.getText(sMessageKey), oError && (oError.message || oError.toString()));
        }
    });
});
