using dwcmission.farm as db from '../db/data-model';

service FarmTankService @(path: '/odata/v4/farm-tank') {
    entity Tanks
      as projection on db.Tanks;
      
    entity TankVolumes
      @(restrict : [
            {
                grant : [ '*' ],
                to : [ 'FieldTechnician' ]
            }
             ])
      as projection on db.TankVolumes_M;

    entity PlantLocation
      as projection on db.ZPLANT_LOCATION;
}
