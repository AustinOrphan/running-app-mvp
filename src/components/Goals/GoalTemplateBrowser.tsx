import React, { useState, useEffect } from 'react';

import { GOAL_TEMPLATE_COLLECTIONS, searchTemplates } from '../../data/goalTemplates';
import { GoalTemplate, GoalTemplateCollection } from '../../types/goalTemplates';

interface GoalTemplateBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: GoalTemplate) => void;
}

interface TemplateCardProps {
  template: GoalTemplate;
  onSelect: () => void;
}

const DifficultyBadge: React.FC<{ difficulty: string }> = ({ difficulty }) => {
  const getColor = (level: string) => {
    switch (level) {
      case 'beginner':
        return '#10b981';
      case 'intermediate':
        return '#f59e0b';
      case 'advanced':
        return '#ef4444';
      default:
        return '#6b7280';
    }
  };

  return (
    <span className='difficulty-badge' style={{ backgroundColor: getColor(difficulty) }}>
      {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
    </span>
  );
};

const TemplateCard: React.FC<TemplateCardProps> = ({ template, onSelect }) => {
  const [expanded, setExpanded] = useState(false);

  const formatTarget = () => {
    if (template.type === 'TIME') {
      const minutes = Math.floor(template.targetValue / 60);
      const seconds = template.targetValue % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${template.targetValue} ${template.targetUnit}`;
  };

  const getPeriodLabel = () => {
    switch (template.period) {
      case 'WEEKLY':
        return 'Weekly';
      case 'MONTHLY':
        return 'Monthly';
      case 'YEARLY':
        return 'Yearly';
      case 'CUSTOM':
        return 'One-time';
      default:
        return template.period;
    }
  };

  return (
    <div className='template-card'>
      <div className='template-header'>
        <div className='template-icon' style={{ color: template.color }}>
          {template.icon}
        </div>
        <div className='template-title'>
          <h4>{template.name}</h4>
          <p className='template-description'>{template.description}</p>
        </div>
        <DifficultyBadge difficulty={template.difficulty} />
      </div>

      <div className='template-details'>
        <div className='template-target'>
          <span className='target-label'>Target:</span>
          <span className='target-value'>{formatTarget()}</span>
        </div>
        <div className='template-period'>
          <span className='period-label'>Period:</span>
          <span className='period-value'>{getPeriodLabel()}</span>
        </div>
        <div className='template-timeframe'>
          <span className='timeframe-label'>Timeframe:</span>
          <span className='timeframe-value'>{template.estimatedTimeframe}</span>
        </div>
      </div>

      <div className='template-tags'>
        {template.tags.map(tag => (
          <span key={tag} className='template-tag' style={{ borderColor: template.color }}>
            {tag}
          </span>
        ))}
      </div>

      {expanded && (
        <div className='template-expanded'>
          {template.prerequisites && template.prerequisites.length > 0 && (
            <div className='template-section'>
              <h5>Prerequisites:</h5>
              <ul>
                {template.prerequisites.map((prereq, index) => (
                  <li key={index}>{prereq}</li>
                ))}
              </ul>
            </div>
          )}

          <div className='template-section'>
            <h5>Training Tips:</h5>
            <ul>
              {template.tips.map((tip, index) => (
                <li key={index}>{tip}</li>
              ))}
            </ul>
          </div>

          {template.milestones && template.milestones.length > 0 && (
            <div className='template-section'>
              <h5>Milestones:</h5>
              <div className='milestones-list'>
                {template.milestones.map((milestone, index) => (
                  <div key={index} className='milestone-item'>
                    <span className='milestone-percentage'>{milestone.percentage}%</span>
                    <span className='milestone-description'>{milestone.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className='template-actions'>
        <button className='btn-secondary template-expand' onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show Less ↑' : 'Learn More ↓'}
        </button>
        <button className='btn-primary template-select' onClick={onSelect}>
          Use This Template
        </button>
      </div>
    </div>
  );
};

const CategorySection: React.FC<{
  collection: GoalTemplateCollection;
  onSelectTemplate: (template: GoalTemplate) => void;
}> = ({ collection, onSelectTemplate }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className='template-category'>
      <div
        className='category-header'
        onClick={() => setExpanded(!expanded)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        role='button'
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`category-templates-${collection.title.replace(/\s+/g, '-').toLowerCase()}`}
      >
        <h3>{collection.title}</h3>
        <p className='category-description'>{collection.description}</p>
        <span className='category-toggle'>{expanded ? '−' : '+'}</span>
      </div>

      {expanded && (
        <div
          className='category-templates'
          id={`category-templates-${collection.title.replace(/\s+/g, '-').toLowerCase()}`}
        >
          {collection.templates.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              onSelect={() => onSelectTemplate(template)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const GoalTemplateBrowser: React.FC<GoalTemplateBrowserProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filteredCollections = GOAL_TEMPLATE_COLLECTIONS.map(collection => {
    let templates = collection.templates;

    // Apply search filter
    if (searchQuery) {
      templates = searchTemplates(searchQuery);
    }

    // Apply difficulty filter
    if (selectedDifficulty) {
      templates = templates.filter(t => t.difficulty === selectedDifficulty);
    }

    // Apply category filter
    if (selectedCategory) {
      templates = templates.filter(t => t.category === selectedCategory);
    }

    return {
      ...collection,
      templates,
    };
  }).filter(collection => collection.templates.length > 0);

  const handleSelectTemplate = (template: GoalTemplate) => {
    onSelectTemplate(template);
    onClose();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      className='template-browser-overlay'
      onClick={onClose}
      onKeyDown={e => e.key === 'Escape' && onClose()}
      role='dialog'
      aria-modal='true'
      tabIndex={-1}
    >
      <div
        className='template-browser'
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role='document'
        tabIndex={0}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
      >
        <div className='template-browser-header'>
          <div className='browser-title'>
            <h2>Goal Templates</h2>
            <p>Choose from proven running goals to jumpstart your training</p>
          </div>
          <button className='btn-icon browser-close' onClick={onClose} title='Close'>
            ×
          </button>
        </div>

        <div className='template-filters'>
          <div className='filter-group'>
            <input
              type='text'
              placeholder='Search templates...'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className='search-input'
            />
          </div>

          <div className='filter-group'>
            <select
              value={selectedDifficulty}
              onChange={e => setSelectedDifficulty(e.target.value)}
              className='filter-select'
            >
              <option value=''>All Difficulties</option>
              <option value='beginner'>Beginner</option>
              <option value='intermediate'>Intermediate</option>
              <option value='advanced'>Advanced</option>
            </select>
          </div>

          <div className='filter-group'>
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className='filter-select'
            >
              <option value=''>All Categories</option>
              <option value='distance'>Distance</option>
              <option value='speed'>Speed</option>
              <option value='consistency'>Consistency</option>
              <option value='endurance'>Endurance</option>
              <option value='race_preparation'>Race Preparation</option>
              <option value='technique'>Technique</option>
            </select>
          </div>
        </div>

        <div className='template-browser-content'>
          {filteredCollections.length === 0 ? (
            <div className='no-templates'>
              <div className='empty-icon'>🔍</div>
              <h3>No templates found</h3>
              <p>Try adjusting your search or filters to find relevant goal templates.</p>
            </div>
          ) : (
            filteredCollections.map(collection => (
              <CategorySection
                key={collection.category}
                collection={collection}
                onSelectTemplate={handleSelectTemplate}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
