package database

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func migrateVideoRemake(tx *gorm.DB) error {
	return tx.AutoMigrate(
		&model.RemakeProject{}, &model.RemakeRevision{}, &model.RemakeRun{},
		&model.RemakeStep{}, &model.RemakeTake{}, &model.RemakeExport{},
		&model.RemakeResourceReference{},
	)
}
