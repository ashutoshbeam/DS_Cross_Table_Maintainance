sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Messaging",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, Messaging, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("ztm.tmapp.controller.BaseController", {
        getRouter: function () {
            return this.getOwnerComponent().getRouter();
        },

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
            var sFullMessage = sMessage;
            if (sDetails && sDetails !== sMessage) {
                sFullMessage += "\n\n" + sDetails;
            }
            MessageBox.error(sFullMessage);
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
        },

        _setBusy: function (bBusy) {
            var oViewModel = this.getModel("view");
            if (oViewModel) {
                oViewModel.setProperty("/busy", bBusy);
            }
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
                        var sError = payload.error
                            || (response.statusText && response.statusText !== "")
                            ? (payload.error || response.statusText)
                            : "Server error (HTTP " + response.status + ")";
                        throw new Error(sError);
                    }
                    return payload;
                });
            });
        },

        _handleActionError: function (sMessageKey, oError) {
            var sDetails = oError && (oError.message || oError.toString());
            if (!sDetails || sDetails === "Error") {
                sDetails = "An unexpected error occurred. Please check the server logs.";
            }
            this.showError(this.getText(sMessageKey), sDetails);
        }
    });
});
