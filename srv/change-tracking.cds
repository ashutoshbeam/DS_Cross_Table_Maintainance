using { DSTableMaintenanceService } from './cap-service';

annotate DSTableMaintenanceService.TankVolumes with @changelog: [TANK_ID] {
  TANK_ID    @changelog;
  VOLUME     @changelog;
  UOM        @changelog;
  COMMENT    @changelog;
  SOURCE     @changelog;
}

annotate DSTableMaintenanceService.PlantLocation with @changelog: [PLANT] {
  PLANT         @changelog;
  COMPANY_CODE  @changelog;
  LOCATION      @changelog;
  LOCATION_TYPE @changelog;
  REGION        @changelog;
}
