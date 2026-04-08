namespace dwcmission.farm;

entity TankVolumes_M {
 key TANK_ID : String(30);
  VOLUME  : Decimal;
  UOM  : String(3);
  TIME_STAMP : Timestamp;
  COMMENT : String(50);
  SOURCE : String(1) default 'M';
}


entity ZPLANT_LOCATION {
  key PLANT : String(4);
  COMPANY_CODE  : String(4);
  LOCATION  : String(10);
  LOCATION_TYPE : String(10);
  REGION : String(10);
}
