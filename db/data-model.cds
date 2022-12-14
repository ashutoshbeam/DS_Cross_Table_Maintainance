namespace dwcmission.farm;

@cds.persistence.exists 
entity Tanks {
  key TANK_ID : String;
  Latitude  : Integer;
  Longitude  : Integer;
  InspectionDate : Date;
  Size : String;
  MeasureTechnique : String;
  max_capacity : Integer;
  UOM : String;
}

entity TankVolumes_M {
  TANK_ID : String(30);
  VOLUME  : Decimal;
  UOM  : String(3);
  TIME_STAMP : Timestamp;
  COMMENT : String(50);
  SOURCE : String(1) default 'M';
  //Tanks  : Association to one Tanks on Tanks.TANK_ID=TANK_ID;
}