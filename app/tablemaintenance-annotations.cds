using DSTableMaintenanceService as service from '../srv/cap-service';

annotate service.PlantLocation with {
    PLANT        @Common.Label : '{i18n>Plant}';
    COMPANY_CODE @Common.Label : '{i18n>CompanyCode}';
    LOCATION     @Common.Label : '{i18n>Location}';
    LOCATION_TYPE @Common.Label : '{i18n>LocationType}';
    REGION       @Common.Label : '{i18n>Region}';
};

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
        LOCATION,
        LOCATION_TYPE,
        REGION,
    ],
    UI.PresentationVariant : {
        SortOrder : [
            {
                Property : PLANT,
                Descending : false,
            },
        ],
        Visualizations : ['@UI.LineItem'],
    },
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Value : PLANT,
            ![@UI.Importance] : #High,
        },
        {
            $Type : 'UI.DataField',
            Value : LOCATION,
            ![@UI.Importance] : #High,
        },
        {
            $Type : 'UI.DataField',
            Value : COMPANY_CODE,
            ![@UI.Importance] : #Medium,
        },
        {
            $Type : 'UI.DataField',
            Value : LOCATION_TYPE,
            ![@UI.Importance] : #Medium,
        },
        {
            $Type : 'UI.DataField',
            Value : REGION,
            ![@UI.Importance] : #Low,
        },
    ],
    UI.Identification : [
        {
            $Type : 'UI.DataField',
            Value : PLANT,
        },
        {
            $Type : 'UI.DataField',
            Value : LOCATION,
        },
        {
            $Type : 'UI.DataField',
            Value : COMPANY_CODE,
        },
    ],
    UI.FieldGroup #General : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : PLANT,
            },
            {
                $Type : 'UI.DataField',
                Value : LOCATION,
            },
            {
                $Type : 'UI.DataField',
                Value : LOCATION_TYPE,
            },
        ],
    },
    UI.FieldGroup #Organizational : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : COMPANY_CODE,
            },
            {
                $Type : 'UI.DataField',
                Value : REGION,
            },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneralFacet',
            Label : '{i18n>GeneralInformation}',
            Target : '@UI.FieldGroup#General',
        },
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'OrganizationalFacet',
            Label : '{i18n>OrganizationalInformation}',
            Target : '@UI.FieldGroup#Organizational',
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
