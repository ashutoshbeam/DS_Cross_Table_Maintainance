sap.ui.define([
    "ztm/tmapp/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], function (BaseController, JSONModel, Device) {
    "use strict";

    return BaseController.extend("ztm.tmapp.controller.App", {
        onInit: function () {
            var oViewModel = new JSONModel({
                busy: false,
                username: "User",
                sideNavExpanded: !Device.system.phone,
                isDisplay: false,
                isDataSteward: false,
                isDataEngineer: false,
                isAdmin: false,
                hasAppAccess: false,
                availableRoleProfiles: [],
                hasMultipleRoles: false,
                selectedModule: "DataMaintenance",
                selectedAdminSection: "roles",
                activeRoleProfile: "",
                activeRoleLabel: "No Roles Assigned",
                activeRoleState: "None"
            });

            this.getView().setModel(oViewModel, "view");
            this.getOwnerComponent().setModel(oViewModel, "shell");

            // Attach route matching handler to keep sidebar in sync with URL
            this.getRouter().attachRouteMatched(this._onRouteMatched, this);

            // Fetch user info from backend initially
            this._loadUserInfo();
        },

        _loadUserInfo: function () {
            var oViewModel = this.getModel("view");
            oViewModel.setProperty("/busy", true);

            this._request("api/schema-browser/user-info")
                .then(function (oUserInfo) {
                    var sUser = oUserInfo.username || "anonymous";
                    oViewModel.setProperty("/username", sUser);
                    var sEmail = oUserInfo.email || (sUser.includes("@") ? sUser : sUser + "@example.com");
                    var bSeedDisplayUser = this._isSeedDisplayUser(sUser, sEmail);
                    var bHasDisplayRole = oUserInfo.isDisplay === true || bSeedDisplayUser;
                    oViewModel.setProperty("/userEmail", sEmail);
                    oViewModel.setProperty("/displayName", this._getFriendlyName(sEmail));
                    oViewModel.setProperty("/logoutRedirectUrl", oUserInfo.logoutRedirectUrl || "");

                    // Save actual roles in view model
                    oViewModel.setProperty("/actualIsDisplay", bHasDisplayRole);
                    oViewModel.setProperty("/actualIsAdmin", oUserInfo.isAdmin === true);
                    oViewModel.setProperty("/actualIsDataEngineer", oUserInfo.isDataEngineer === true);
                    oViewModel.setProperty("/actualIsDataSteward", oUserInfo.isDataSteward === true);

                    // Build available simulation profiles dynamically based on actual assigned roles
                    var aProfiles = [];
                    if (bHasDisplayRole) {
                        aProfiles.push({ key: "ZTM_Display", text: "ZTM Display" });
                    }
                    if (oUserInfo.isDataSteward === true) {
                        aProfiles.push({ key: "ZTM_DataSteward", text: "ZTM Business User / Steward" });
                    }
                    if (oUserInfo.isDataEngineer === true) {
                        aProfiles.push({ key: "ZTM_DataEngineer", text: "ZTM Data Engineer / Architect" });
                    }
                    if (oUserInfo.isAdmin === true) {
                        aProfiles.push({ key: "ZTM_Admin", text: "ZTM Global Administrator" });
                    }
                    oViewModel.setProperty("/availableRoleProfiles", aProfiles);
                    oViewModel.setProperty("/hasMultipleRoles", aProfiles.length > 1);

                    // Set simulation profile based on highest backend role
                    if (oUserInfo.isAdmin === true) {
                        oViewModel.setProperty("/activeRoleProfile", "ZTM_Admin");
                        this._applyRoleProfile("ZTM_Admin");
                    } else if (oUserInfo.isDataEngineer === true) {
                        oViewModel.setProperty("/activeRoleProfile", "ZTM_DataEngineer");
                        this._applyRoleProfile("ZTM_DataEngineer");
                    } else if (oUserInfo.isDataSteward === true) {
                        oViewModel.setProperty("/activeRoleProfile", "ZTM_DataSteward");
                        this._applyRoleProfile("ZTM_DataSteward");
                    } else if (bHasDisplayRole) {
                        oViewModel.setProperty("/activeRoleProfile", "ZTM_Display");
                        this._applyRoleProfile("ZTM_Display");
                    } else {
                        oViewModel.setProperty("/activeRoleProfile", "");
                        this._applyRoleProfile("");
                    }
                }.bind(this))
                .catch(function (oError) {
                    console.warn("Failed to fetch user-info:", oError);
                    oViewModel.setProperty("/availableRoleProfiles", []);
                    oViewModel.setProperty("/hasMultipleRoles", false);
                    oViewModel.setProperty("/activeRoleProfile", "");
                    this._applyRoleProfile("");
                }.bind(this))
                .finally(function () {
                    oViewModel.setProperty("/busy", false);
                });
        },

        _getFriendlyName: function (sEmailOrUser) {
            if (!sEmailOrUser) return "User";
            var sUserPart = sEmailOrUser.includes("@") ? sEmailOrUser.split("@")[0] : sEmailOrUser;
            var sName = sUserPart.replace(/[\._\-]/g, " ");
            return sName.replace(/\b\w/g, function (char) {
                return char.toUpperCase();
            });
        },

        _isSeedDisplayUser: function (sUser, sEmail) {
            var aValues = [sUser, sEmail].map(function (sValue) {
                return String(sValue || "").toLowerCase();
            });

            return aValues.some(function (sValue) {
                return sValue === "amith.vandana.incture@beamsuntory.com"
                    || sValue === "ashutosh.shukla@beamsuntory.com"
                    || sValue === "amith.vandana.incture"
                    || sValue === "ashutosh.shukla"
                    || sValue.indexOf("amith.vandana.incture") > -1
                    || sValue.indexOf("ashutosh.shukla") > -1;
            });
        },

        onRoleProfileChange: function (oEvent) {
            var sKey = oEvent.getParameter("selectedItem").getKey();
            this._applyRoleProfile(sKey);
        },

        _applyRoleProfile: function (sProfileKey) {
            var oViewModel = this.getModel("view");
            var sCurrentModule = oViewModel.getProperty("/selectedModule");

            if (sProfileKey === "ZTM_Admin") {
                oViewModel.setProperty("/isDisplay", true);
                oViewModel.setProperty("/isDataSteward", true);
                oViewModel.setProperty("/isDataEngineer", true);
                oViewModel.setProperty("/isAdmin", true);
                oViewModel.setProperty("/hasAppAccess", true);
                oViewModel.setProperty("/activeRoleLabel", "ZTM Global Administrator");
                oViewModel.setProperty("/activeRoleState", "Success");
            } else if (sProfileKey === "ZTM_DataEngineer") {
                oViewModel.setProperty("/isDisplay", true);
                oViewModel.setProperty("/isDataSteward", true);
                oViewModel.setProperty("/isDataEngineer", true);
                oViewModel.setProperty("/isAdmin", false);
                oViewModel.setProperty("/hasAppAccess", true);
                oViewModel.setProperty("/activeRoleLabel", "ZTM Data Engineer / Architect");
                oViewModel.setProperty("/activeRoleState", "Warning");

                // If currently on AdminConsole, kick out to DataMaintenance
                if (String(sCurrentModule || "").indexOf("AdminConsole") === 0) {
                    this.getRouter().navTo("DSTableList");
                }
            } else if (sProfileKey === "ZTM_DataSteward") {
                oViewModel.setProperty("/isDisplay", true);
                oViewModel.setProperty("/isDataSteward", true);
                oViewModel.setProperty("/isDataEngineer", false);
                oViewModel.setProperty("/isAdmin", false);
                oViewModel.setProperty("/hasAppAccess", true);
                oViewModel.setProperty("/activeRoleLabel", "ZTM Business User / Steward");
                oViewModel.setProperty("/activeRoleState", "None");

                // If on restricted modules, kick out to DataMaintenance
                if (String(sCurrentModule || "").indexOf("AdminConsole") === 0 || sCurrentModule === "TableDesigner") {
                    this.getRouter().navTo("DSTableList");
                }
            } else if (sProfileKey === "ZTM_Display") {
                oViewModel.setProperty("/isDisplay", true);
                oViewModel.setProperty("/isDataSteward", false);
                oViewModel.setProperty("/isDataEngineer", false);
                oViewModel.setProperty("/isAdmin", false);
                oViewModel.setProperty("/hasAppAccess", true);
                oViewModel.setProperty("/activeRoleLabel", "ZTM Display");
                oViewModel.setProperty("/activeRoleState", "Information");

                if (String(sCurrentModule || "").indexOf("AdminConsole") === 0 || sCurrentModule === "TableDesigner") {
                    this.getRouter().navTo("DSTableList");
                }
            } else {
                oViewModel.setProperty("/isDisplay", false);
                oViewModel.setProperty("/isDataSteward", false);
                oViewModel.setProperty("/isDataEngineer", false);
                oViewModel.setProperty("/isAdmin", false);
                oViewModel.setProperty("/hasAppAccess", false);
                oViewModel.setProperty("/activeRoleLabel", "No Roles Assigned");
                oViewModel.setProperty("/activeRoleState", "Error");

                // Kick out of restricted modules
                this.getRouter().navTo("DSTableList");
            }
        },

        onProfilePress: function (oEvent) {
            var oSource = oEvent.getSource();
            var oView = this.getView();

            if (!this._oProfilePopover) {
                this.loadFragment({
                    name: "ztm.tmapp.fragment.ProfilePopover"
                }).then(function (oPopover) {
                    this._oProfilePopover = oPopover;
                    oView.addDependent(this._oProfilePopover);
                    this._oProfilePopover.openBy(oSource);
                }.bind(this));
            } else {
                this._oProfilePopover.openBy(oSource);
            }
        },

        onProfilePopoverClose: function () {
            if (this._oProfilePopover) {
                this._oProfilePopover.close();
            }
        },

        onLogoutPress: function () {
            var oPopover = this._oProfilePopover;
            sap.m.MessageBox.confirm("Are you sure you want to sign out?", {
                actions: [sap.m.MessageBox.Action.YES, sap.m.MessageBox.Action.NO],
                emphasizedAction: sap.m.MessageBox.Action.YES,
                onClose: function (sAction) {
                    if (sAction === sap.m.MessageBox.Action.YES) {
                        if (oPopover) {
                            oPopover.close();
                        }

                        // Determine the logout endpoint based on prefix routing
                        var sLogoutUrl = "/my/logout";
                        var sPath = window.location.pathname;
                        if (sPath && sPath.split("/").length > 1) {
                            var aParts = sPath.split("/");
                            var sAppPrefix = aParts[1];
                            if (sAppPrefix && sAppPrefix !== "index.html") {
                                sLogoutUrl = "/" + sAppPrefix + "/my/logout";
                            }
                        }

                        // Determine the redirect landing page
                        var oViewModel = this.getModel("view");
                        var sLogoutPageUrl = oViewModel.getProperty("/logoutRedirectUrl") || sap.ui.require.toUrl("ztm/tmapp/logout.html");
                        var sRedirectParam = window.location.origin + window.location.pathname;
                        var sFinalRedirectUrl = sLogoutPageUrl + "?redirect=" + encodeURIComponent(sRedirectParam);

                        // Trigger local logout via AJAX to bypass Single Logout (SLO) corporate redirects
                        fetch(sLogoutUrl + "?skip-redirect=true", {
                            method: "GET",
                            credentials: "same-origin"
                        }).then(function () {
                            window.location.replace(sFinalRedirectUrl);
                        }).catch(function (oError) {
                            console.error("Logout request failed, redirecting anyway", oError);
                            window.location.replace(sFinalRedirectUrl);
                        });
                    }
                }.bind(this)
            });
        },

        onSideNavCollapsePress: function () {
            var oViewModel = this.getModel("view");
            var bExpanded = oViewModel.getProperty("/sideNavExpanded");
            oViewModel.setProperty("/sideNavExpanded", !bExpanded);
        },

        onModuleSelect: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            var sKey = oItem.getKey();
            var oViewModel = this.getModel("view");

            oViewModel.setProperty("/selectedModule", sKey);

            if (sKey === "DataMaintenance") {
                this.getRouter().navTo("DSTableList");
            } else if (sKey === "TableDesigner") {
                this.getRouter().navTo("TableDesigner");
            } else if (sKey === "AdminConsole") {
                oViewModel.setProperty("/selectedAdminSection", "roles");
                this.getRouter().navTo("AdminConsole", {
                    query: {
                        section: "roles"
                    }
                });
            } else if (sKey.indexOf("AdminConsole_") === 0) {
                var sSection = sKey.replace("AdminConsole_", "");
                oViewModel.setProperty("/selectedAdminSection", sSection);
                this.getRouter().navTo("AdminConsole", {
                    query: {
                        section: sSection
                    }
                });
            }
        },

        _onRouteMatched: function (oEvent) {
            var sRouteName = oEvent.getParameter("name");
            var oViewModel = this.getModel("view");
            var oArgs = oEvent.getParameter("arguments") || {};
            var oQuery = oArgs["?query"] || {};
            var sAdminSection = oQuery.section || oViewModel.getProperty("/selectedAdminSection") || "roles";

            if (sRouteName === "DSTableList" || sRouteName === "PlantLocationObjectPage" || sRouteName === "PlantLocationChangeHistory") {
                oViewModel.setProperty("/selectedModule", "DataMaintenance");
            } else if (sRouteName === "TableDesigner" || sRouteName === "CreateTable" || sRouteName === "AlterTable") {
                oViewModel.setProperty("/selectedModule", "TableDesigner");
            } else if (sRouteName === "AdminConsole") {
                oViewModel.setProperty("/selectedAdminSection", sAdminSection);
                oViewModel.setProperty("/selectedModule", "AdminConsole_" + sAdminSection);
            }
        }
    });
});
