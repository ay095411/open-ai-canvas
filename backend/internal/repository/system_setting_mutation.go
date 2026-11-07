package repository

import (
	"errors"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// MutateSystemSettingWithAudit serializes settings updates across connections
// and commits their audit together. A write before the read also locks the
// first insert and avoids SQLite's deferred read-to-write transaction upgrade.
func (r *Repository) MutateSystemSettingWithAudit(key, initialJSON string, mutate func(*model.SystemSetting) (*model.AdminAuditEvent, error)) (*model.SystemSetting, error) {
	var setting model.SystemSetting
	err := r.db.Transaction(func(tx *gorm.DB) error {
		seed := model.SystemSetting{Key: key, ValueJSON: initialJSON}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.Assignments(map[string]any{"key": key}),
		}).Create(&seed).Error; err != nil {
			return err
		}
		if err := tx.First(&setting, "key = ?", key).Error; err != nil {
			return err
		}
		audit, err := mutate(&setting)
		if err != nil {
			return err
		}
		if audit == nil || setting.Key != key {
			return errors.New("system setting mutation requires an audit and the original key")
		}
		if err := tx.Save(&setting).Error; err != nil {
			return err
		}
		return tx.Create(audit).Error
	})
	if err != nil {
		return nil, err
	}
	return &setting, nil
}
