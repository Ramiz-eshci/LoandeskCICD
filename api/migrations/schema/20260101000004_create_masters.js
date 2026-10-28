'use strict';

/**
 * Migration: master / lookup tables (Doc-02 Section 4 & 19).
 * Convention: IF OBJECT_ID guard, IDENTITY PK, unique business code,
 * standard audit columns (is_active, flag_deleted, created_*, updated_*, deleted_on).
 * Prefer configurable master tables over hardcoded dropdowns.
 */

const AUDIT = `
        is_active    BIT NOT NULL DEFAULT 1,
        flag_deleted BIT NOT NULL DEFAULT 0,
        created_by   INT NULL,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_by   INT NULL,
        updated_at   DATETIME2 NULL,
        deleted_on   DATETIME2 NULL`;

async function table(db, name, bodySql) {
  await db.raw(`IF OBJECT_ID('dbo.${name}','U') IS NULL CREATE TABLE dbo.${name} (${bodySql});`);
}
async function index(db, ix, tbl, cols) {
  await db.raw(
    `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='${ix}') CREATE INDEX ${ix} ON dbo.${tbl}(${cols});`
  );
}

module.exports = {
  async up(db) {
    await table(db, 'branches', `
        branch_id   INT IDENTITY(1,1) PRIMARY KEY,
        branch_code NVARCHAR(30)  NOT NULL,
        branch_name NVARCHAR(150) NOT NULL,
        address     NVARCHAR(255) NULL,
        city        NVARCHAR(100) NULL,
        state       NVARCHAR(100) NULL,
        postcode    NVARCHAR(20)  NULL,
        phone       NVARCHAR(30)  NULL,
        email       NVARCHAR(150) NULL,
        ${AUDIT},
        CONSTRAINT UQ_branches_code UNIQUE (branch_code)`);

    await table(db, 'product_types', `
        product_type_id INT IDENTITY(1,1) PRIMARY KEY,
        code            NVARCHAR(30)  NOT NULL,
        name            NVARCHAR(150) NOT NULL,
        description     NVARCHAR(255) NULL,
        ${AUDIT},
        CONSTRAINT UQ_product_types_code UNIQUE (code)`);

    await table(db, 'products', `
        product_id      INT IDENTITY(1,1) PRIMARY KEY,
        product_type_id INT NULL,
        code            NVARCHAR(30)  NOT NULL,
        name            NVARCHAR(150) NOT NULL,
        description     NVARCHAR(255) NULL,
        min_amount      DECIMAL(18,2) NULL,
        max_amount      DECIMAL(18,2) NULL,
        min_term_months INT NULL,
        max_term_months INT NULL,
        ${AUDIT},
        CONSTRAINT UQ_products_code UNIQUE (code),
        CONSTRAINT FK_products_type FOREIGN KEY (product_type_id) REFERENCES dbo.product_types(product_type_id)`);
    await index(db, 'IX_products_type', 'products', 'product_type_id');

    await table(db, 'loan_purposes', `
        loan_purpose_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL,
        name NVARCHAR(150) NOT NULL,
        ${AUDIT},
        CONSTRAINT UQ_loan_purposes_code UNIQUE (code)`);

    await table(db, 'applicant_types', `
        applicant_type_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL,
        name NVARCHAR(150) NOT NULL,
        ${AUDIT},
        CONSTRAINT UQ_applicant_types_code UNIQUE (code)`);

    await table(db, 'application_statuses', `
        application_status_id INT IDENTITY(1,1) PRIMARY KEY,
        code        NVARCHAR(40)  NOT NULL,
        name        NVARCHAR(150) NOT NULL,
        sort_order  INT NOT NULL DEFAULT 0,
        is_terminal BIT NOT NULL DEFAULT 0,
        ${AUDIT},
        CONSTRAINT UQ_application_statuses_code UNIQUE (code)`);

    await table(db, 'enquiry_statuses', `
        enquiry_status_id INT IDENTITY(1,1) PRIMARY KEY,
        code        NVARCHAR(40)  NOT NULL,
        name        NVARCHAR(150) NOT NULL,
        sort_order  INT NOT NULL DEFAULT 0,
        is_terminal BIT NOT NULL DEFAULT 0,
        ${AUDIT},
        CONSTRAINT UQ_enquiry_statuses_code UNIQUE (code)`);

    await table(db, 'document_types', `
        document_type_id INT IDENTITY(1,1) PRIMARY KEY,
        code     NVARCHAR(40)  NOT NULL,
        name     NVARCHAR(150) NOT NULL,
        category NVARCHAR(80)  NULL,
        ${AUDIT},
        CONSTRAINT UQ_document_types_code UNIQUE (code)`);

    await table(db, 'valuation_types', `
        valuation_type_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL,
        name NVARCHAR(150) NOT NULL,
        ${AUDIT},
        CONSTRAINT UQ_valuation_types_code UNIQUE (code)`);

    await table(db, 'brokers', `
        broker_id INT IDENTITY(1,1) PRIMARY KEY,
        code           NVARCHAR(30)  NOT NULL,
        name           NVARCHAR(150) NOT NULL,
        company        NVARCHAR(150) NULL,
        email          NVARCHAR(150) NULL,
        phone          NVARCHAR(30)  NULL,
        commission_pct DECIMAL(5,2)  NULL,
        ${AUDIT},
        CONSTRAINT UQ_brokers_code UNIQUE (code)`);

    await table(db, 'solicitors', `
        solicitor_id INT IDENTITY(1,1) PRIMARY KEY,
        code  NVARCHAR(30)  NOT NULL,
        name  NVARCHAR(150) NOT NULL,
        firm  NVARCHAR(150) NULL,
        email NVARCHAR(150) NULL,
        phone NVARCHAR(30)  NULL,
        ${AUDIT},
        CONSTRAINT UQ_solicitors_code UNIQUE (code)`);

    await table(db, 'interest_rates', `
        rate_id    INT IDENTITY(1,1) PRIMARY KEY,
        product_id INT NULL,
        name       NVARCHAR(150) NOT NULL,
        rate_pct   DECIMAL(6,3) NOT NULL,
        rate_type  NVARCHAR(20) NOT NULL DEFAULT 'Fixed',
        effective_from DATE NULL,
        effective_to   DATE NULL,
        ${AUDIT},
        CONSTRAINT FK_rates_product FOREIGN KEY (product_id) REFERENCES dbo.products(product_id)`);
    await index(db, 'IX_rates_product', 'interest_rates', 'product_id');

    await table(db, 'repayment_frequencies', `
        repayment_frequency_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL,
        name NVARCHAR(100) NOT NULL,
        payments_per_year INT NOT NULL,
        ${AUDIT},
        CONSTRAINT UQ_repay_freq_code UNIQUE (code)`);

    await table(db, 'loan_terms', `
        loan_term_id INT IDENTITY(1,1) PRIMARY KEY,
        term_months  INT NOT NULL,
        name         NVARCHAR(80) NOT NULL,
        ${AUDIT},
        CONSTRAINT UQ_loan_terms_months UNIQUE (term_months)`);

    await table(db, 'application_sources', `
        application_source_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(30) NOT NULL,
        name NVARCHAR(150) NOT NULL,
        ${AUDIT},
        CONSTRAINT UQ_app_sources_code UNIQUE (code)`);

    await table(db, 'rejection_reasons', `
        rejection_reason_id INT IDENTITY(1,1) PRIMARY KEY,
        code NVARCHAR(40) NOT NULL,
        name NVARCHAR(200) NOT NULL,
        ${AUDIT},
        CONSTRAINT UQ_rejection_reasons_code UNIQUE (code)`);

    await table(db, 'approval_conditions', `
        approval_condition_id INT IDENTITY(1,1) PRIMARY KEY,
        code        NVARCHAR(40)  NOT NULL,
        name        NVARCHAR(200) NOT NULL,
        description NVARCHAR(500) NULL,
        ${AUDIT},
        CONSTRAINT UQ_approval_conditions_code UNIQUE (code)`);
  },

  async down(db) {
    const drop = [
      'approval_conditions','rejection_reasons','application_sources','loan_terms',
      'repayment_frequencies','interest_rates','solicitors','brokers','valuation_types',
      'document_types','enquiry_statuses','application_statuses','applicant_types',
      'loan_purposes','products','product_types','branches',
    ];
    for (const t of drop) {
      await db.raw(`IF OBJECT_ID('dbo.${t}','U') IS NOT NULL DROP TABLE dbo.${t};`);
    }
  },
};
