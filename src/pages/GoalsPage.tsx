import React, { useState, useEffect } from 'react';
import { Goal, CreateGoalData } from '../types/goals';
import { useToast } from '../hooks/useToast';
import { useGoals } from '../hooks/useGoals';
import { GoalCard } from '../components/GoalCard';
import { CreateGoalModal } from '../components/CreateGoalModal';
import { EditGoalModal } from '../components/EditGoalModal';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { GoalAchievementNotification } from '../components/GoalAchievementNotification';

interface GoalsPageProps {}

export const GoalsPage: React.FC<GoalsPageProps> = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deletingGoal, setDeletingGoal] = useState<Goal | null>(null);
  const [currentAchievement, setCurrentAchievement] = useState<Goal | null>(null);
  
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
  } = useGoals(token);

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

  const handleGoalCreated = async (goalData: CreateGoalData) => {
    try {
      await createGoal(goalData);
      setShowCreateModal(false);
      showToast('Goal created successfully!', 'success');
    } catch (error) {
      console.error('Error creating goal:', error);
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
      console.error('Error updating goal:', error);
      showToast('Failed to update goal', 'error');
    }
  };

  const handleCompleteGoal = async (goalId: string) => {
    try {
      await completeGoal(goalId);
      showToast('Congratulations! Goal completed! 🎉', 'success');
    } catch (error) {
      console.error('Error completing goal:', error);
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
      console.error('Error deleting goal:', error);
      showToast('Failed to delete goal', 'error');
    }
  };

  const cancelDeleteGoal = () => {
    setShowDeleteConfirmation(false);
    setDeletingGoal(null);
  };



  if (loading) {
    return (
      <div className="goals-page tab-panel">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading goals...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="goals-page tab-panel">
        <div className="error-container">
          <div className="error-icon">❌</div>
          <h3>Failed to Load Goals</h3>
          <p>{error}</p>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="goals-page tab-panel">
      <div className="goals-header">
        <h2>Running Goals</h2>
        <button className="btn-primary" onClick={handleCreateGoal}>
          + New Goal
        </button>
      </div>

      {/* Active Goals */}
      <div className="goals-section">
        <h3>Active Goals ({activeGoals.length})</h3>
        {activeGoals.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎯</div>
            <h4>No active goals</h4>
            <p>Set your first running goal to start tracking your progress!</p>
            <button className="btn-primary" onClick={handleCreateGoal}>
              Create Your First Goal
            </button>
          </div>
        ) : (
          <div className="goals-grid">
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
        <div className="goals-section">
          <h3>Completed Goals ({completedGoals.length})</h3>
          <div className="goals-grid">
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
        title="Delete Goal"
        message={`Are you sure you want to delete "${deletingGoal?.title}"? This action cannot be undone.`}
        confirmText="Delete Goal"
        cancelText="Cancel"
        type="danger"
        onConfirm={confirmDeleteGoal}
        onCancel={cancelDeleteGoal}
      />

      {/* Goal Achievement Notification */}
      <GoalAchievementNotification
        achievedGoal={currentAchievement}
        onClose={handleAchievementClose}
      />
    </div>
  );
};