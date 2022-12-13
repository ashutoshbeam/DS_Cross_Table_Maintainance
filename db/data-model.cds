namespace buildapps.schema;

@cds.persistence.exists 
entity Tanks {
  key TANK_ID : String;
  Latitude  : Decimal;
  Longitude  : Decimal;
  InspectionDate : Date;
  Size : String(50);
  MeasureTechnique : String(50);
  max_capacity : Integer;
  UOM : String(3);
}

@cds.persistence.exists
entity TankVolumes_M {
  TANK_ID : String(30);
  VOLUME  : Decimal;
  UOM  : String(3);
  TIME_STAMP : Timestamp;
  COMMENT : String(50);
  SOURCE : String(1) default 'M';
  Tanks  : Association to one Tanks on Tanks.TANK_ID=TANK_ID;
}