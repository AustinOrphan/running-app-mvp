import React, { useState, useEffect } from 'react';
import { Goal, GoalProgress, CreateGoalData } from '../types/goals';
import { useToast } from '../hooks/useToast';
import { GoalCard } from '../components/GoalCard';
import { CreateGoalModal } from '../components/CreateGoalModal';

interface GoalsPageProps {}

export const GoalsPage: React.FC<GoalsPageProps> = () => {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalProgress, setGoalProgress] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { showToast } = useToast();

  const fetchGoals = async () => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/goals', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const goalsData = await response.json();
        setGoals(goalsData);
        
        // Fetch progress data
        const progressResponse = await fetch('/api/goals/progress/all', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (progressResponse.ok) {
          const progressData = await progressResponse.json();
          setGoalProgress(progressData);
        }
      } else {
        showToast('Failed to fetch goals', 'error');
      }
    } catch (error) {
      console.error('Error fetching goals:', error);
      showToast('Failed to fetch goals', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGoals();
  }, []);

  const handleCreateGoal = () => {
    setShowCreateModal(true);
  };

  const handleGoalCreated = async (goalData: CreateGoalData) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/goals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(goalData)
      });
      
      if (response.ok) {
        setShowCreateModal(false);
        fetchGoals(); // Refresh goals list
        showToast('Goal created successfully!', 'success');
      } else {
        const errorData = await response.json();
        showToast(errorData.message || 'Failed to create goal', 'error');
      }
    } catch (error) {
      console.error('Error creating goal:', error);
      showToast('Failed to create goal', 'error');
    }
  };

  const handleCompleteGoal = async (goalId: string) => {
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/goals/${goalId}/complete`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        fetchGoals(); // Refresh goals list
        showToast('Congratulations! Goal completed! 🎉', 'success');
      } else {
        const errorData = await response.json();
        showToast(errorData.message || 'Failed to complete goal', 'error');
      }
    } catch (error) {
      console.error('Error completing goal:', error);
      showToast('Failed to complete goal', 'error');
    }
  };

  const handleDeleteGoal = async (goalId: string) => {
    if (!confirm('Are you sure you want to delete this goal?')) {
      return;
    }

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/goals/${goalId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        fetchGoals(); // Refresh goals list
        showToast('Goal deleted', 'info');
      } else {
        const errorData = await response.json();
        showToast(errorData.message || 'Failed to delete goal', 'error');
      }
    } catch (error) {
      console.error('Error deleting goal:', error);
      showToast('Failed to delete goal', 'error');
    }
  };

  const getGoalProgress = (goalId: string): GoalProgress | undefined => {
    return goalProgress.find(p => p.goalId === goalId);
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

  const activeGoals = goals.filter(goal => !goal.isCompleted);
  const completedGoals = goals.filter(goal => goal.isCompleted);

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
    </div>
  );
};