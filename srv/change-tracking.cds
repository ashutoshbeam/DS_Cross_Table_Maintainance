using { FarmTankService } from './cap-service';

annotate FarmTankService.TankVolumes with @changelog: [TANK_ID] {
  TANK_ID    @changelog;
  VOLUME     @changelog;
  UOM        @changelog;
  COMMENT    @changelog;
  SOURCE     @changelog;
}

annotate FarmTankService.PlantLocation with @changelog: [PLANT] {
  PLANT         @changelog;
  COMPANY_CODE  @changelog;
  LOCATION      @changelog;
  LOCATION_TYPE @changelog;
  REGION        @changelog;
}
