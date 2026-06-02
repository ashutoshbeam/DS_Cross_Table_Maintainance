sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/Device"
], function (UIComponent, Device) {
    "use strict";

    return UIComponent.extend("ztm.tmapp.Component", {
        metadata: {
            manifest: "json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);
            this.getRouter().initialize();
        },

        getContentDensityClass: function () {
            if (this._sContentDensityClass === undefined) {
                this._sContentDensityClass = Device.support.touch ? "sapUiSizeCozy" : "sapUiSizeCompact";
            }
            return this._sContentDensityClass;
        }
    });
});
