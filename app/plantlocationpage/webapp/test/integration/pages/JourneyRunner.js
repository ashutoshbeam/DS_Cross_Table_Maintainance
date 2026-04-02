sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"plantlocationpage/test/integration/pages/PlantLocationList",
	"plantlocationpage/test/integration/pages/PlantLocationObjectPage"
], function (JourneyRunner, PlantLocationList, PlantLocationObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('plantlocationpage') + '/test/flp.html#app-preview',
        pages: {
			onThePlantLocationList: PlantLocationList,
			onThePlantLocationObjectPage: PlantLocationObjectPage
        },
        async: true
    });

    return runner;
});

