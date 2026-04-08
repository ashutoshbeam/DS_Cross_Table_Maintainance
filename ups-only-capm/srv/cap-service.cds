service PlantLocationService @(path: '/odata/v4/plant-location') {
  @Capabilities.InsertRestrictions.Insertable : true
  @Capabilities.UpdateRestrictions.Updatable : true
  @Capabilities.DeleteRestrictions.Deletable : true
  entity PlantLocation {
    key PLANT         : String(4);
        COMPANY_CODE  : String(4);
        LOCATION      : String(10);
        LOCATION_TYPE : String(10);
        REGION        : String(10);
  }
}
