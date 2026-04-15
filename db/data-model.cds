namespace dwcmission.farm;

using {
  managed
} from '@sap/cds/common';

entity TankVolumes_M : managed {
  key TANK_ID : String(30);
  ID : UUID @cds.on.insert: $uuid;
  VOLUME  : Decimal;
  UOM  : String(3);
  TIME_STAMP : Timestamp;
  COMMENT : String(50);
  SOURCE : String(1) default 'M';
}


entity ZPLANT_LOCATION : managed {
  key PLANT : String(4);
  ID : UUID @cds.on.insert: $uuid;
  COMPANY_CODE  : String(4);
  LOCATION  : String(10);
  LOCATION_TYPE : String(10);
  REGION : String(10);
}
