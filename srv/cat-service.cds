using dwcmission.farm as db from '../db/data-model';

service FarmTankService {
    entity Tanks as select * from db.Tanks;
    entity TankVolumes as projection on db.TankVolumes;
}