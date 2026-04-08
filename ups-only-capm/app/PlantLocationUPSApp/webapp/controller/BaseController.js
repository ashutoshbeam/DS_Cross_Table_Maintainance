sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Messaging",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, Messaging, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("upsonly.plantlocationapp.controller.BaseController", {
        getModel: function (sName) {
            return this.getView().getModel(sName);
        },

        setModel: function (oModel, sName) {
            return this.getView().setModel(oModel, sName);
        },

        getResourceBundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        },

        getText: function (sKey, aArgs) {
            return this.getResourceBundle().getText(sKey, aArgs);
        },

        showToast: function (sMessage) {
            MessageToast.show(sMessage);
        },

        showError: function (sMessage, sDetails) {
            MessageBox.error(sMessage, { details: sDetails });
        },

        clearErrorMessages: function () {
            var aMessages = Messaging.getMessageModel().getData().filter(function (oMessage) {
                return oMessage.type === "Error";
            });

            if (aMessages.length) {
                Messaging.removeMessages(aMessages);
            }
        },

        getErrorMessages: function () {
            return Messaging.getMessageModel().getData().filter(function (oMessage) {
                return oMessage.type === "Error";
            });
        },

        submitBatch: function (sGroupId) {
            var sResolvedGroupId = sGroupId || "plantLocationGroup";

            this.clearErrorMessages();

            return this.getOwnerComponent().getModel().submitBatch(sResolvedGroupId)
                .then(function () {
                    return new Promise(function (resolve) {
                        setTimeout(resolve, 0);
                    });
                })
                .then(function () {
                    var aErrors = this.getErrorMessages();

                    if (aErrors.length) {
                        throw new Error(aErrors.map(function (oMessage) {
                            return oMessage.message;
                        }).join("\n"));
                    }
                }.bind(this));
        }
    });
});
