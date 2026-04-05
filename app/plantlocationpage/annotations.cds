using FarmTankService as service from '../../srv/cap-service';
annotate service.PlantLocation with @(
    Common.SemanticKey : [PLANT],
    UI.HeaderInfo : {
        TypeName : '{i18n>PlantLocationTypeName}',
        TypeNamePlural : '{i18n>PlantLocationTypeNamePlural}',
        Title : {
            $Type : 'UI.DataField',
            Value : PLANT,
        },
        Description : {
            $Type : 'UI.DataField',
            Value : LOCATION,
        },
    },
    UI.SelectionFields : [
        PLANT,
        COMPANY_CODE,
        LOCATION_TYPE,
        REGION,
    ],
    UI.Identification : [
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Plant}',
            Value : PLANT,
        },
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Companycode}',
            Value : COMPANY_CODE,
        },
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Location}',
            Value : LOCATION,
        },
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Locationtype}',
            Value : LOCATION_TYPE,
        },
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Region}',
            Value : REGION,
        },
    ],
    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Label : '{i18n>Plant}',
                Value : PLANT,
            },
            {
                $Type : 'UI.DataField',
                Label : '{i18n>Companycode}',
                Value : COMPANY_CODE,
            },
            {
                $Type : 'UI.DataField',
                Label : '{i18n>Location}',
                Value : LOCATION,
            },
            {
                $Type : 'UI.DataField',
                Label : '{i18n>Locationtype}',
                Value : LOCATION_TYPE,
            },
            {
                $Type : 'UI.DataField',
                Label : '{i18n>Region}',
                Value : REGION,
            },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneratedFacet1',
            Label : '{i18n>GeneralInformation}',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
    ],
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Plant}',
            Value : PLANT,
        },
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Companycode}',
            Value : COMPANY_CODE,
        },
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Location}',
            Value : LOCATION,
        },
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Locationtype}',
            Value : LOCATION_TYPE,
        },
        {
            $Type : 'UI.DataField',
            Label : '{i18n>Region}',
            Value : REGION,
        },
    ],
);

annotate service.PlantLocation with @Capabilities : {
    InsertRestrictions : {
        Insertable : true,
    },
    UpdateRestrictions : {
        Updatable : true,
    },
    DeleteRestrictions : {
        Deletable : true,
    },
};

