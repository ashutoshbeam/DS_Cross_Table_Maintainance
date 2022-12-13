using buildapps.schema as db from '../db/data-model';

service FarmTankService {
    view Tanks as select * from db.Tanks;
    entity TankVolumes as projection on db.TankVolumes_M;
}