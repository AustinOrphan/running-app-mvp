import React, { useState, useEffect } from 'react';

import { ConfirmationModal } from '../components/ConfirmationModal';
import { CreateGoalModal } from '../components/CreateGoalModal';
import { EditGoalModal } from '../components/EditGoalModal';
import { GoalAchievementNotification } from '../components/GoalAchievementNotification';
import { GoalCard } from '../components/GoalCard';
import { GoalAnalyticsDashboard } from '../components/Goals/GoalAnalyticsDashboard';
import { GoalTemplateBrowser } from '../components/Goals/GoalTemplateBrowser';
import { TemplateCustomizationModal } from '../components/Goals/TemplateCustomizationModal';
import { useGoalAnalytics } from '../hooks/useGoalAnalytics';
import { useGoals } from '../hooks/useGoals';
import { useToast } from '../hooks/useToast';
import { Goal, CreateGoalData } from '../types/goals';
import { GoalTemplate } from '../types/goalTemplates';
import { logError } from '../utils/clientLogger';

export const GoalsPage: React.FC = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const [currentAchievement, setCurrentAchievement] = useState<Goal | null>(null);
  const [showTemplateBrowser, setShowTemplateBrowser] = useState(false);
  const [showTemplateCustomization, setShowTemplateCustomization] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<GoalTemplate | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const { showToast } = useToast();
  const token = localStorage.getItem('authToken');

  const {
    goals,
    loading,
    error,
    activeGoals,
    completedGoals,
    newlyAchievedGoals,
    createGoal,
    updateGoal,
    deleteGoal,
    completeGoal,
    getGoalProgress,
    markAchievementSeen,
    goalProgress,
  } = useGoals(token);

  const { analytics, insights } = useGoalAnalytics(goals, goalProgress, loading);

  // Handle newly achieved goals
  useEffect(() => {
    if (newlyAchievedGoals.length > 0 && !currentAchievement) {
      const nextAchievement = newlyAchievedGoals[0];
      setCurrentAchievement(nextAchievement);
    }
  }, [newlyAchievedGoals, currentAchievement]);

  const handleAchievementClose = () => {
    if (currentAchievement) {
      markAchievementSeen(currentAchievement.id);
      setCurrentAchievement(null);

      // Show the next achievement if there are more
      const remainingAchievements = newlyAchievedGoals.filter(
        goal => goal.id !== currentAchievement.id
      );
      if (remainingAchievements.length > 0) {
        setTimeout(() => {
          setCurrentAchievement(remainingAchievements[0]);
        }, 500);
      }
    }
  };

  const handleCreateGoal = () => {
    setShowCreateModal(true);
  };

  const handleBrowseTemplates = () => {
    setShowTemplateBrowser(true);
  };

  const handleSelectTemplate = (template: GoalTemplate) => {
    setSelectedTemplate(template);
    setShowTemplateBrowser(false);
    setShowTemplateCustomization(true);
  };

  const handleTemplateCustomizationConfirm = async (goalData: CreateGoalData) => {
    try {
      await createGoal(goalData);
      setShowTemplateCustomization(false);
      setSelectedTemplate(null);
      showToast('Goal created from template successfully!', 'success');
    } catch (error) {
      logError(
        'Error creating goal from template',
        error instanceof Error ? error : new Error(String(error))
      );
      showToast('Failed to create goal from template', 'error');
    }
  };

  const handleTemplateCustomizationClose = () => {
    setShowTemplateCustomization(false);
    setSelectedTemplate(null);
  };

  const handleGoalCreated = async (goalData: CreateGoalData) => {
    try {
      await createGoal(goalData);
      setShowCreateModal(false);
      showToast('Goal created successfully!', 'success');
    } catch (error) {
      logError('Error creating goal', error instanceof Error ? error : new Error(String(error)));
      showToast('Failed to create goal', 'error');
    }
  };

  const handleEditGoal = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (goal) {
      setEditingGoal(goal);
      setShowEditModal(true);
    }
  };

  const handleGoalUpdated = async (goalId: string, goalData: Partial<Goal>) => {
    try {
      await updateGoal(goalId, goalData);
      setShowEditModal(false);
      setEditingGoal(null);
      showToast('Goal updated successfully!', 'success');
    } catch (error) {
      logError('Error updating goal', error instanceof Error ? error : new Error(String(error)));
      showToast('Failed to update goal', 'error');
    }
  };

  const handleCompleteGoal = async (goalId: string) => {
    try {
      await completeGoal(goalId);
      showToast('Congratulations! Goal completed! 🎉', 'success');
    } catch (error) {
      logError('Error completing goal', error instanceof Error ? error : new Error(String(error)));
      showToast('Failed to complete goal', 'error');
    }
  };

  const handleDeleteGoal = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    if (goal) {
      setDeletingGoal(goal);
      setShowDeleteConfirmation(true);
    }
  };

  const confirmDeleteGoal = async () => {
    if (!deletingGoal) return;

    try {
      await deleteGoal(deletingGoal.id);
      setShowDeleteConfirmation(false);
      setDeletingGoal(null);
      showToast('Goal deleted successfully', 'info');
    } catch (error) {
      logError('Error deleting goal', error instanceof Error ? error : new Error(String(error)));
      showToast('Failed to delete goal', 'error');
    }
  };

  const cancelDeleteGoal = () => {
    setShowDeleteConfirmation(false);
    setDeletingGoal(null);
  };

  if (loading) {
    return (
      <div className='goals-page tab-panel'>
        <div className='loading-container'>
          <div className='loading-spinner'></div>
          <p>Loading goals...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className='goals-page tab-panel'>
        <div className='error-container'>
          <div className='error-icon'>❌</div>
          <h3>Failed to Load Goals</h3>
          <p>{error}</p>
          <button className='btn-primary' onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='goals-page tab-panel'>
      <div className='goals-header'>
        <h2>Running Goals</h2>
        <div className='goals-header-actions'>
          <button className='btn-secondary' onClick={() => setShowAnalytics(true)}>
            📊 Analytics
          </button>
          <button className='btn-secondary' onClick={handleBrowseTemplates}>
            📝 Browse Templates
          </button>
          <button className='btn-primary' onClick={handleCreateGoal}>
            + New Goal
          </button>
        </div>
      </div>

      {/* Active Goals */}
      <div className='goals-section'>
        <h3>Active Goals ({activeGoals.length})</h3>
        {activeGoals.length === 0 ? (
          <div className='empty-state'>
            <div className='empty-icon'>🎯</div>
            <h4>No active goals</h4>
            <p>Set your first running goal to start tracking your progress!</p>
            <div className='empty-state-actions'>
              <button className='btn-secondary' onClick={handleBrowseTemplates}>
                📝 Browse Templates
              </button>
              <button className='btn-primary' onClick={handleCreateGoal}>
                Create Custom Goal
              </button>
            </div>
          </div>
        ) : (
          <div className='goals-grid'>
            {activeGoals.map(goal => (
              <GoalCard
                key={goal.id}
                goal={goal}
                progress={getGoalProgress(goal.id)}
                onComplete={handleCompleteGoal}
                onDelete={handleDeleteGoal}
                onEdit={handleEditGoal}
              />
            ))}
          </div>
        )}
      </div>

      {/* Completed Goals */}
      {completedGoals.length > 0 && (
        <div className='goals-section'>
          <h3>Completed Goals ({completedGoals.length})</h3>
          <div className='goals-grid'>
            {completedGoals.map(goal => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onComplete={handleCompleteGoal}
                onDelete={handleDeleteGoal}
              />
            ))}
          </div>
        </div>
      )}

      {/* Create Goal Modal */}
      <CreateGoalModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleGoalCreated}
      />

      {/* Edit Goal Modal */}
      <EditGoalModal
        isOpen={showEditModal}
        goal={editingGoal}
        onClose={() => {
          setShowEditModal(false);
          setEditingGoal(null);
        }}
        onSubmit={handleGoalUpdated}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={showDeleteConfirmation}
        title='Delete Goal'
        message={`Are you sure you want to delete "${deletingGoal?.title}"? This action cannot be undone.`}
        confirmText='Delete Goal'
        cancelText='Cancel'
        type='danger'
        onConfirm={confirmDeleteGoal}
        onCancel={cancelDeleteGoal}
        onClose={cancelDeleteGoal}
      />

      {/* Goal Achievement Notification */}
      <GoalAchievementNotification
        achievedGoal={currentAchievement}
        onClose={handleAchievementClose}
      />

      {/* Template Browser */}
      <GoalTemplateBrowser
        isOpen={showTemplateBrowser}
        onClose={() => setShowTemplateBrowser(false)}
        onSelectTemplate={handleSelectTemplate}
      />

      {/* Template Customization Modal */}
      <TemplateCustomizationModal
        template={selectedTemplate}
        isOpen={showTemplateCustomization}
        onClose={handleTemplateCustomizationClose}
        onConfirm={handleTemplateCustomizationConfirm}
      />

      {/* Analytics Dashboard */}
      <GoalAnalyticsDashboard
        analytics={analytics}
        insights={insights}
        isOpen={showAnalytics}
        onClose={() => setShowAnalytics(false)}
      />
    </div>
  );
};
