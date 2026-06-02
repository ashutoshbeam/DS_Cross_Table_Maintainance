sap.ui.define([
    "ztm.app/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (BaseController, JSONModel, Filter, FilterOperator) {
    "use strict";

    return BaseController.extend("ztm.app.controller.ChangeHistory", {
        onInit: function () {
            this.setModel(new JSONModel({
                busy: false,
                plant: "",
                search: "",
                history: [],
                filteredHistory: []
            }), "view");

            this.getRouter().getRoute("PlantLocationChangeHistory").attachPatternMatched(this.onObjectMatched, this);
        },

        onObjectMatched: function (oEvent) {
            var sPlant = decodeURIComponent(oEvent.getParameter("arguments").plant || ""),
                sEscapedPlant = sPlant.replace(/'/g, "''");

            this.getModel("view").setProperty("/plant", sPlant);
            this.getModel("view").setProperty("/search", "");
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
                        this._loadHistory();
                    }.bind(this)
                }
            });
        },

        onSearch: function (oEvent) {
            this.getModel("view").setProperty("/search", oEvent.getParameter("newValue") || "");
            this._applyFilters();
        },

        onNavBack: function () {
            var sPlant = this.getModel("view").getProperty("/plant");

            this.getRouter().navTo("PlantLocationObjectPage", {
                plant: sPlant
            });
        },

        _loadHistory: function () {
            var oBinding = this.getView().getBindingContext();

            if (!oBinding) {
                return this._loadHistoryDirect();
            }

            return oBinding.requestObject()
                .then(function (oEntity) {
                    var sEntityKey = oEntity && (oEntity.ID || oEntity.PLANT || "");

                    this.getModel("view").setProperty("/plant", oEntity && oEntity.PLANT ? oEntity.PLANT : this.getModel("view").getProperty("/plant"));

                    return oBinding.requestObject("changes")
                        .then(function (aChanges) {
                            if (aChanges && aChanges.length) {
                                this.getModel("view").setProperty("/history", aChanges);
                                this._applyFilters();
                                return undefined;
                            }

                            return this._loadHistoryDirect(sEntityKey);
                        }.bind(this));
                }.bind(this))
                .finally(function () {
                    this.getModel("view").setProperty("/busy", false);
                    this.getView().setBusy(false);
                }.bind(this));
        },

        _loadHistoryDirect: function (sEntityKey) {
            var sPlant = this.getModel("view").getProperty("/plant"),
                oModel = this.getOwnerComponent().getModel(),
                aFilters = [
                    new Filter({
                        filters: [
                            new Filter("entityKey", FilterOperator.EQ, sEntityKey || sPlant),
                            new Filter("objectID", FilterOperator.EQ, sEntityKey || sPlant),
                            new Filter("parentObjectID", FilterOperator.EQ, sEntityKey || sPlant)
                        ],
                        and: false
                    })
                ],
                oListBinding;

            if (!sPlant) {
                this.getModel("view").setProperty("/history", []);
                this.getModel("view").setProperty("/filteredHistory", []);
                this.getModel("view").setProperty("/busy", false);
                this.getView().setBusy(false);
                return Promise.resolve();
            }

            oListBinding = oModel.bindList("/ChangeView", undefined, undefined, aFilters);

            return oListBinding.requestContexts(0, 200)
                .then(function (aContexts) {
                    var aHistory = (aContexts || []).map(function (oContext) {
                        return oContext.getObject();
                    });

                    this.getModel("view").setProperty("/history", aHistory);
                    this._applyFilters();
                }.bind(this))
                .catch(function () {
                    this.getModel("view").setProperty("/history", []);
                    this.getModel("view").setProperty("/filteredHistory", []);
                }.bind(this));
        },

        _applyFilters: function () {
            var oViewModel = this.getModel("view"),
                aHistory = oViewModel.getProperty("/history") || [],
                sSearch = (oViewModel.getProperty("/search") || "").toLowerCase(),
                aFiltered;

            if (!sSearch) {
                aFiltered = aHistory;
            } else {
                aFiltered = aHistory.filter(function (oRow) {
                    return [
                        oRow.modification,
                        oRow.entity,
                        oRow.objectID,
                        oRow.attribute,
                        oRow.valueChangedTo,
                        oRow.valueChangedFrom,
                        oRow.createdBy,
                        oRow.createdAt
                    ].some(function (v) {
                        return String(v ?? "").toLowerCase().indexOf(sSearch) > -1;
                    });
                });
            }

            oViewModel.setProperty("/filteredHistory", aFiltered);
        }
    });
});
