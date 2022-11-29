namespace dwcmission.farm;

entity Tanks {
  key TANK_ID : String;
  Latitude  : String;
  Longitude  : String;
  InspectionDate : String;
  Size : String;
  MeasureTechnique : String;
  max_capacity : Integer;
  UOM : String;
}

entity TankVolumes {
  TANK_ID : String;
  VOLUME  : Integer;
  UOM  : String;
  TIME_STAMP : Timestamp;
  COMMENT : String;
  SOURCE : String;
}