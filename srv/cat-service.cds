using dwcmission.farm as my from '../db/data-model';

service FarmTankService {
    view Tanks as select * from my.Tanks;
    entity TankVolumes as projection on my.TankVolumes;
}